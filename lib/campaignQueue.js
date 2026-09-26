import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { deliveryError } from './delivery.js';
import { personalize } from './dashboard.js';
import { compileEmail, renderEmail, createMessageId, unsubscribeMailto } from './emailContent.js';

export const activeStatuses = ['queued','checking','sending'];
export const canResume = result => result.status === 'pending' || result.status === 'retrying' || result.status === 'failed' && result.delivery?.safeToRetry;
export function createCampaignQueue({state,save,sender,verify,dataDir,concurrency=2,delay=500,retryDelay=3000,maxAttempts=3,dailyLimit=500,now=Date.now}) {
  let running = false, closed = false, nextStart = 0;
  const sleep = async (ms, campaign) => {
    const end = Date.now() + ms;
    while (Date.now() < end && !closed && activeStatuses.includes(campaign.status)) await new Promise(resolve => setTimeout(resolve,Math.min(100,end-Date.now())));
  };
  function audit(campaign,result,event) {
    try { appendFileSync(join(dataDir,'delivery-events.ndjson'),JSON.stringify({at:new Date().toISOString(),campaignId:campaign.id,recipientId:result?.id,event,status:result?.status,delivery:result?.delivery,messageId:result?.messageId})+'\n'); }
    catch { console.error('Could not append delivery audit event. Campaign state remains the source of truth.'); }
  }
  function usage() {
    const cutoff = now() - 86400000;
    return state.campaigns.flatMap(c=>c.results).filter(r=>['sent','unknown','sending'].includes(r.status) && new Date((r.status==='sending'?r.attemptedAt:r.at) || r.attemptedAt || 0).getTime()>cutoff).length;
  }
  async function sendOne(campaign,result,compiled) {
    for (let attempt=0;attempt<maxAttempts;attempt++) {
      if (closed || campaign.status !== 'sending') return;
      const start = Math.max(Date.now(),nextStart); nextStart = start+delay;
      await sleep(start-Date.now(),campaign);
      if (closed || campaign.status !== 'sending') return;
      if (state.suppressions?.some(s=>s.email===result.email.toLowerCase())) {
        result.status='skipped';result.error='Recipient unsubscribed. No email sent.';result.at=new Date().toISOString();save();audit(campaign,result,'suppressed');return;
      }
      if (dailyLimit && usage()>=dailyLimit) {
        campaign.status='paused'; campaign.lastError=deliveryError({code:'DAILY_LIMIT'}); save(); return;
      }
      result.status='sending'; result.attempts=(result.attempts||0)+1;
      result.attemptedAt=new Date().toISOString();
      result.messageId ||= createMessageId();
      save(); audit(campaign,result,'attempt');
      let info, failure;
      try {
        const unsubscribe=campaign.kind==='marketing'?unsubscribeMailto(result):undefined;
        info = await sender({to:result.email,subject:personalize(campaign.subject,result),...renderEmail(campaign,result,compiled,unsubscribe),messageId:result.messageId,...(unsubscribe?{headers:{'List-Unsubscribe':`<${unsubscribe}>`}}:{})});
      } catch(error) { failure=deliveryError(error); }
      result.at=new Date().toISOString();
      if (!failure) {
        result.status='sent'; result.messageId=info?.messageId || info?.id || result.messageId;
        delete result.error; delete result.delivery; delete result.nextAttemptAt;
        save(); audit(campaign,result,'accepted'); return;
      }
      result.delivery=failure; result.error=failure.message;
      if (failure.retryable && attempt+1<maxAttempts && campaign.status==='sending') {
        const backoff=retryDelay * 2**attempt;
        result.status='retrying'; result.nextAttemptAt=new Date(Date.now()+backoff).toISOString();
        save(); audit(campaign,result,'retry_scheduled'); await sleep(backoff,campaign); continue;
      }
      delete result.nextAttemptAt;
      result.status=failure.uncertain?'unknown':'failed';
      if (failure.pause || failure.retryable) {
        // A user-requested stop always wins over an in-flight provider error.
        if(campaign.status==='sending') campaign.status='paused';
        campaign.lastError={...failure,message:failure.retryable?'The provider is still deferring messages. Sending is paused; resume later to retry only unsent messages.':failure.message};
      }
      save(); audit(campaign,result,'failed'); return;
    }
  }
  async function run(campaign) {
    const compiled=compileEmail(campaign);
    campaign.status='checking'; delete campaign.finishedAt; delete campaign.lastError; save();
    try { await verify(); }
    catch(error) { if(campaign.status==='checking') {campaign.status='paused';campaign.lastError=deliveryError(error,{preflight:true});save();audit(campaign,null,'connection_failed');} return; }
    if(closed || campaign.status!=='checking') return;
    campaign.status='sending'; campaign.startedAt ||= new Date().toISOString(); save();
    const recipients=campaign.results.filter(r=>canResume(r)&&(!campaign.runRecipientIds||campaign.runRecipientIds.includes(r.id))); let index=0;
    await Promise.all(Array.from({length:concurrency},async()=>{
      while(!closed && campaign.status==='sending' && index<recipients.length) {
        const result=recipients[index++]; await sendOne(campaign,result,compiled);
      }
    }));
    if(campaign.status==='sending') campaign.status=campaign.results.some(r=>!['sent','skipped'].includes(r.status))?'completed_with_errors':'sent';
    campaign.finishedAt=new Date().toISOString(); save();
  }
  async function pump() {
    if(running || closed) return;
    running=true;
    try {
      let next;
      while(!closed && (next=state.campaigns.filter(c=>c.status==='queued').sort((a,b)=>a.queuedAt.localeCompare(b.queuedAt))[0])) {
        try { await run(next); }
        catch(error) {
          next.status='interrupted';
          next.lastError={message:'Sending stopped because campaign progress could not be saved. Check disk space before resuming.'};
          // Preserve any ambiguous attempt as unknown, even if another worker is finishing.
          next.results.filter(r=>r.status==='sending').forEach(r=>{r.status='unknown';r.error='Progress could not be saved. Check Gmail Sent before retrying.';});
          try{save();}catch{ /* no sends continue while storage is unavailable */ }
          console.error('Campaign storage failure:',error.code || 'UNKNOWN');
          closed=true;
        }
      }
    } finally {running=false;}
  }
  return {
    start(){void pump();},
    usage,
    get running(){return running;},
    async close(){closed=true;while(running)await new Promise(resolve=>setTimeout(resolve,20));},
  };
}
