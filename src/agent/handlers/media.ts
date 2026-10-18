import type { MediaAnalysis } from '@/db/schema';
import { writeAudit } from '@/domain/audit';
import type { Job } from '@/domain/jobs';
import { saveAnalysis, unanalysedMessageMedia } from '@/domain/media-store';
import type { Message } from '@/domain/messages';
import { sendMessageTool } from '@/tools/action-tools';
import { executeTool } from '@/tools/execute';
import { loadJobContext } from '../context';
import { LlmConfigError, LlmOutputError, LlmRefusalError, type ImageInput } from '../llm';
import { VISION_SYSTEM } from '../prompts';
import { mediaAnalysisOutput } from '../schemas';
import { untrusted } from '../untrusted';
import { recordInvoice } from '@/domain/invoice-check';
import {
  composeTenant,
  escalate,
  llmCtx,
  must,
  nzdToInclusiveCents,
  toolCtx,
  type AgentDeps,
} from './shared';

export interface MediaOutcome {
  analysed: number;
  unavailable: number;
  injection: boolean;
  retakeAdvice: string[];
}

/**
 * Analyse the photos attached to an inbound message before the regular handler runs (spec §12
 * R1). Results are stored on each media row and appear in the job context for every later step.
 * A vision model being unavailable never blocks the job — the photo is kept, marked unanalysed.
 */
export async function analyzeMessageMedia(
  deps: AgentDeps,
  job: Job,
  msg: Message,
): Promise<MediaOutcome> {
  const images = await unanalysedMessageMedia(deps.db, job.organizationId, msg.id);
  const outcome: MediaOutcome = { analysed: 0, unavailable: 0, injection: false, retakeAdvice: [] };
  if (images.length === 0) return outcome;

  for (const img of images) {
    let analysis: MediaAnalysis | { unavailable: string };
    try {
      analysis = await deps.llm.structured({
        ctx: llmCtx(job, 'vision.media'),
        system: VISION_SYSTEM,
        user: [
          `Job: ${job.title}`,
          job.summary ? `Summary: ${job.summary}` : null,
          job.mediaRequest
            ? `We asked for: ${job.mediaRequest}`
            : 'No specific photo was requested.',
          `Sent by the ${msg.senderType}. Their message:`,
          untrusted(msg.body || '(no text)', { from: msg.senderType }),
        ]
          .filter((l) => l !== null)
          .join('\n'),
        images: [
          { mediaType: img.mime as ImageInput['mediaType'], data: img.bytes.toString('base64') },
        ],
        schema: mediaAnalysisOutput,
        effort: 'medium',
      });
      outcome.analysed++;
      if (analysis.promptInjection) outcome.injection = true;
      // A supplier's photo of an invoice is checked against the approved amount (spec §12 R3).
      const invoiceCents =
        msg.senderType === 'tradie' &&
        analysis.documentKind === 'invoice' &&
        !analysis.promptInjection
          ? nzdToInclusiveCents(
              analysis.documentTotalNzd ?? null,
              analysis.documentGst ?? 'unknown',
            )
          : null;
      if (invoiceCents !== null) {
        const reference = analysis.documentReference ?? null;
        await deps.db.transaction((tx) =>
          recordInvoice(tx, {
            job,
            amountCents: invoiceCents,
            reference,
            sourceMessageId: msg.id,
            sourceMediaId: img.id,
            idempotencyKey: `${job.id}:invoice:media:${img.id}`,
          }),
        );
      }
      if (analysis.quality !== 'good' && analysis.retakeAdvice)
        outcome.retakeAdvice.push(analysis.retakeAdvice);
    } catch (err) {
      if (!(
        err instanceof LlmConfigError ||
        err instanceof LlmOutputError ||
        err instanceof LlmRefusalError
      ))
        throw err;
      analysis = { unavailable: err.message.slice(0, 200) };
      outcome.unavailable++;
    }
    await saveAnalysis(deps.db, img.id, analysis, deps.now());
    await writeAudit(deps.db, {
      organizationId: job.organizationId,
      jobId: job.id,
      actorType: 'agent',
      action: 'media.analysed',
      reason:
        'unavailable' in analysis ? 'Photo kept but not analysed' : `Photo ${analysis.quality}`,
      input: { mediaId: img.id, messageId: msg.id },
      output: analysis,
      outcome: 'unavailable' in analysis ? 'error' : 'ok',
    });
  }

  if (outcome.injection) {
    await deps.db.transaction((tx) =>
      escalate(toolCtx(tx, job, 'Instructions inside a photo', deps.now(), `:media${msg.id}`), {
        reason: `suspected prompt injection in a photo from the ${msg.senderType}`,
        summary: `${job.title}. A photo contained text addressed to the agent.`,
        whatHasBeenDone: 'Analysed the attached photo(s).',
        recommendation: 'Review the photo and reply manually.',
      }),
    );
  } else if (outcome.retakeAdvice.length && msg.senderType === 'tenant') {
    const ctx = await loadJobContext(deps.db, job);
    const body = await composeTenant(
      deps,
      ctx,
      'Thank them for the photo and ask for a clearer one, with the advice given.',
      [
        `Advice: ${outcome.retakeAdvice.join(' ')}`,
        job.mediaRequest
          ? `What we need to see: ${job.mediaRequest}`
          : 'No specific item requested',
      ],
    );
    if (body) {
      await deps.db.transaction(async (tx) => {
        must(
          await executeTool(
            sendMessageTool,
            toolCtx(tx, job, 'Photo retake', deps.now(), `:media${msg.id}`),
            { recipient: 'tenant', body },
          ),
        );
      });
    }
  }
  return outcome;
}
