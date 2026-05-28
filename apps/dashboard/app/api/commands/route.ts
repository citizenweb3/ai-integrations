import {
  acceptDiscoveryCandidateCommand,
  approveContactCandidateCommand,
  approveDraftForSendCommand,
  attachInboundToThreadCommand,
  clearSuppressionCommand,
  createDraftCommand,
  createStartCampaignCommand,
  discardDraftCommand,
  generateDraftCommand,
  generateWarmDraftCommand,
  markClaimResolvedCommand,
  mergeThreadsCommand,
  pauseAllSendsCommand,
  recomputeQualityScoreCommand,
  recordDraftFeedbackCommand,
  refreshResearchSnapshotCommand,
  rejectContactCandidateCommand,
  rejectDiscoveryCandidateCommand,
  requestAiReviseCommand,
  requestManualEditSaveCommand,
  requestResearchMoreCommand,
  resumeAllSendsCommand,
  resolvePolicyStateCommand,
  runCampaignDiscoveryCommand,
  setPrimaryContactCommand,
  suppressContactCommand,
  traceOperation,
  updateCampaignScopeCommand,
  type TraceSpanHandle
} from "@bizdev/db";
import { createCommandRequestSchema } from "@bizdev/shared";
import { NextResponse } from "next/server";
import { logger } from "../../../lib/logger";
import { runWithRequestContext } from "../../../lib/request-context";

export async function POST(request: Request) {
  return runWithRequestContext(request, (requestId) =>
    traceOperation({
      serviceName: "dashboard",
      name: "dashboard.commandExecution",
      kind: "server",
      correlationId: requestId,
      attributes: {
        route: "/api/commands",
        method: request.method,
        requestId
      }
    }, (span) => handlePost(request, span))
  );
}

async function handlePost(request: Request, traceSpan?: TraceSpanHandle) {
  const contentType = request.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  let body: unknown;
  try {
    body = isJson
      ? await request.json()
      : formDataToCommand(await request.formData());
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Request body could not be parsed";
    if (isJson) {
      return NextResponse.json(
        { error: { code: "parse_error", message } },
        { status: 400 }
      );
    }
    const redirect = safeRedirectUrl(request);
    redirect.searchParams.set("error", `parse_error: ${message}`);
    return NextResponse.redirect(redirect, { status: 303 });
  }

  const parsed = createCommandRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "validation_error",
          message: "Request body failed schema validation",
          details: parsed.error.flatten()
        }
      },
      { status: 400 }
    );
  }

  try {
  switch (parsed.data.commandType) {
    case "start_campaign": {
      const result = traceCommandResult(traceSpan, await createStartCampaignCommand({
        ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
        payload: parsed.data.payload
      }));
      if (isJson) {
        return NextResponse.json({
          campaignId: result.campaign.id,
          commandId: result.command.id,
          jobId: result.job.id
        });
      }
      return NextResponse.redirect(safeRedirectUrl(request), { status: 303 });
    }

    case "update_campaign_scope": {
      const result = traceCommandResult(traceSpan, await updateCampaignScopeCommand({
        ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
        payload: parsed.data.payload
      }));
      if (!result.ok) {
        if (isJson) {
          return NextResponse.json({ error: result.failure }, { status: 409 });
        }
        const redirect = safeRedirectUrl(request);
        redirect.searchParams.set("error", `${result.failure.code}: ${result.failure.message}`);
        return NextResponse.redirect(redirect, { status: 303 });
      }
      if (isJson) {
        return NextResponse.json({
          campaignId: result.campaign.id,
          commandId: result.command.id,
          jobId: result.job.id
        });
      }
      return NextResponse.redirect(safeRedirectUrl(request), { status: 303 });
    }

    case "approve_draft_for_send": {
      const fromEmail = resolveApproveFromEmail();
      if (!fromEmail) {
        const message = "RESEND_FROM_EMAIL is not configured";
        if (isJson) {
          return NextResponse.json(
            { error: { code: "configuration_error", message } },
            { status: 500 }
          );
        }
        const redirect = safeRedirectUrl(request);
        redirect.searchParams.set("error", `configuration_error: ${message}`);
        return NextResponse.redirect(redirect, { status: 303 });
      }
      const result = traceCommandResult(traceSpan, await approveDraftForSendCommand({
        ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
        payload: parsed.data.payload,
        fromEmail
      }));
      if (!result.ok) {
        if (isJson) {
          return NextResponse.json({ error: result.failure }, { status: 409 });
        }
        const redirect = safeRedirectUrl(request);
        redirect.searchParams.set("error", `${result.failure.code}: ${result.failure.message}`);
        return NextResponse.redirect(redirect, { status: 303 });
      }
      if (isJson) {
        return NextResponse.json({
          commandId: result.command.id,
          outboundMessageId: result.outboundMessageId,
          jobId: result.jobId,
          deduplicated: result.deduplicated
        });
      }
      return NextResponse.redirect(safeRedirectUrl(request), { status: 303 });
    }

    case "pause_all_sends": {
      const result = traceCommandResult(traceSpan, await pauseAllSendsCommand({
        ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
        payload: parsed.data.payload
      }));
      if (isJson) {
        return NextResponse.json({
          commandId: result.command.id,
          paused: result.state.paused,
          reason: result.state.reason,
          expiresAt: result.state.expiresAt?.toISOString() ?? null,
          idempotencyKey: result.idempotencyKey,
          deduplicated: result.deduplicated
        });
      }
      return NextResponse.redirect(safeRedirectUrl(request), { status: 303 });
    }

    case "resume_all_sends": {
      const result = traceCommandResult(traceSpan, await resumeAllSendsCommand({
        ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
        payload: parsed.data.payload
      }));
      if (isJson) {
        return NextResponse.json({
          commandId: result.command.id,
          paused: result.state.paused,
          idempotencyKey: result.idempotencyKey,
          deduplicated: result.deduplicated
        });
      }
      return NextResponse.redirect(safeRedirectUrl(request), { status: 303 });
    }

    case "attach_inbound_to_thread": {
      const result = traceCommandResult(traceSpan, await attachInboundToThreadCommand({
        ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
        payload: parsed.data.payload
      }));
      if (!result.ok) {
        if (isJson) {
          return NextResponse.json({ error: result.failure }, { status: 409 });
        }
        const redirect = safeRedirectUrl(request);
        redirect.searchParams.set("error", `${result.failure.code}: ${result.failure.message}`);
        return NextResponse.redirect(redirect, { status: 303 });
      }
      if (isJson) {
        return NextResponse.json({
          commandId: result.command.id,
          threadId: result.threadId,
          threadCreated: result.threadCreated,
          inboundMessageId: result.inboundMessageId,
          resolvedWorkItemId: result.resolvedWorkItemId,
          deduplicated: result.deduplicated
        });
      }
      return NextResponse.redirect(safeRedirectUrl(request), { status: 303 });
    }

    case "merge_threads": {
      const result = traceCommandResult(traceSpan, await mergeThreadsCommand({
        ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
        payload: parsed.data.payload
      }));
      if (!result.ok) {
        if (isJson) {
          return NextResponse.json({ error: result.failure }, { status: 409 });
        }
        const redirect = safeRedirectUrl(request);
        redirect.searchParams.set("error", `${result.failure.code}: ${result.failure.message}`);
        return NextResponse.redirect(redirect, { status: 303 });
      }
      if (isJson) {
        return NextResponse.json({
          commandId: result.command.id,
          primaryThreadId: result.primaryThreadId,
          secondaryThreadId: result.secondaryThreadId,
          moved: result.moved,
          deduplicated: result.deduplicated
        });
      }
      return NextResponse.redirect(safeRedirectUrl(request), { status: 303 });
    }

    case "suppress_contact": {
      const result = traceCommandResult(traceSpan, await suppressContactCommand({
        ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
        payload: parsed.data.payload
      }));
      if (!result.ok) {
        if (isJson) {
          return NextResponse.json({ error: result.failure }, { status: 409 });
        }
        const redirect = safeRedirectUrl(request);
        redirect.searchParams.set("error", `${result.failure.code}: ${result.failure.message}`);
        return NextResponse.redirect(redirect, { status: 303 });
      }
      if (isJson) {
        return NextResponse.json({
          commandId: result.command.id,
          suppressionId: result.suppressionId,
          reactivated: result.reactivated,
          deduplicated: result.deduplicated
        });
      }
      return NextResponse.redirect(safeRedirectUrl(request), { status: 303 });
    }

    case "clear_suppression": {
      const result = traceCommandResult(traceSpan, await clearSuppressionCommand({
        ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
        payload: parsed.data.payload
      }));
      if (!result.ok) {
        if (isJson) {
          return NextResponse.json({ error: result.failure }, { status: 409 });
        }
        const redirect = safeRedirectUrl(request);
        redirect.searchParams.set("error", `${result.failure.code}: ${result.failure.message}`);
        return NextResponse.redirect(redirect, { status: 303 });
      }
      if (isJson) {
        return NextResponse.json({
          commandId: result.command.id,
          suppressionId: result.suppressionId,
          deduplicated: result.deduplicated
        });
      }
      return NextResponse.redirect(safeRedirectUrl(request), { status: 303 });
    }

    case "approve_contact_candidate": {
      const result = traceCommandResult(traceSpan, await approveContactCandidateCommand({
        ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
        payload: parsed.data.payload
      }));
      if (!result.ok) {
        if (isJson) {
          return NextResponse.json({ error: result.failure }, { status: 409 });
        }
        const redirect = safeRedirectUrl(request);
        if (result.failure.code === "contact_org_mismatch") {
          redirect.searchParams.set("confirmContactCandidateId", result.failure.candidateId);
          redirect.searchParams.set("confirmContactId", result.failure.contactId);
          redirect.searchParams.set("confirmExistingOrganizationId", result.failure.existingOrganizationId);
          redirect.searchParams.set("confirmCandidateOrganizationId", result.failure.candidateOrganizationId);
          redirect.searchParams.set("confirmEmail", result.failure.email);
        }
        redirect.searchParams.set("error", `${result.failure.code}: ${result.failure.message}`);
        return NextResponse.redirect(redirect, { status: 303 });
      }
      if (isJson) {
        return NextResponse.json({
          commandId: result.command.id,
          candidateId: result.candidateId,
          contactId: result.contactId,
          contactCreated: result.contactCreated,
          contactReattached: result.contactReattached,
          previousContactOrganizationId: result.previousContactOrganizationId,
          deduplicated: result.deduplicated
        });
      }
      return NextResponse.redirect(safeRedirectUrl(request), { status: 303 });
    }

    case "set_primary_contact": {
      const result = traceCommandResult(traceSpan, await setPrimaryContactCommand({
        ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
        payload: parsed.data.payload
      }));
      if (!result.ok) {
        if (isJson) {
          return NextResponse.json({ error: result.failure }, { status: 409 });
        }
        const redirect = safeRedirectUrl(request);
        redirect.searchParams.set("error", `${result.failure.code}: ${result.failure.message}`);
        return NextResponse.redirect(redirect, { status: 303 });
      }
      if (isJson) {
        return NextResponse.json({
          commandId: result.command.id,
          organizationId: result.organizationId,
          contactId: result.contactId,
          previousContactId: result.previousContactId,
          changed: result.changed,
          deduplicated: result.deduplicated
        });
      }
      return NextResponse.redirect(safeRedirectUrl(request), { status: 303 });
    }

    case "reject_contact_candidate": {
      const result = traceCommandResult(traceSpan, await rejectContactCandidateCommand({
        ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
        payload: parsed.data.payload
      }));
      if (!result.ok) {
        if (isJson) {
          return NextResponse.json({ error: result.failure }, { status: 409 });
        }
        const redirect = safeRedirectUrl(request);
        redirect.searchParams.set("error", `${result.failure.code}: ${result.failure.message}`);
        return NextResponse.redirect(redirect, { status: 303 });
      }
      if (isJson) {
        return NextResponse.json({
          commandId: result.command.id,
          candidateId: result.candidateId,
          deduplicated: result.deduplicated
        });
      }
      return NextResponse.redirect(safeRedirectUrl(request), { status: 303 });
    }

    case "create_draft": {
      const result = traceCommandResult(traceSpan, await createDraftCommand({
        ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
        payload: parsed.data.payload
      }));
      if (!result.ok) {
        if (isJson) {
          return NextResponse.json({ error: result.failure }, { status: 409 });
        }
        const redirect = safeRedirectUrl(request);
        redirect.searchParams.set("error", `${result.failure.code}: ${result.failure.message}`);
        return NextResponse.redirect(redirect, { status: 303 });
      }
      if (isJson) {
        return NextResponse.json({
          commandId: result.command.id,
          draftId: result.draftId,
          workItemId: result.workItemId,
          deduplicated: result.deduplicated
        });
      }
      const target = new URL(`/drafts/${result.draftId}`, safeRedirectUrl(request));
      return NextResponse.redirect(target, { status: 303 });
    }

    case "request_manual_edit_save": {
      const result = traceCommandResult(traceSpan, await requestManualEditSaveCommand({
        ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
        payload: parsed.data.payload
      }));
      if (!result.ok) {
        if (isJson) {
          return NextResponse.json({ error: result.failure }, { status: 409 });
        }
        const redirect = safeRedirectUrl(request);
        redirect.searchParams.set("error", `${result.failure.code}: ${result.failure.message}`);
        return NextResponse.redirect(redirect, { status: 303 });
      }
      if (isJson) {
        return NextResponse.json({
          commandId: result.command.id,
          draftId: result.draftId,
          newVersion: result.newVersion,
          deduplicated: result.deduplicated
        });
      }
      return NextResponse.redirect(safeRedirectUrl(request), { status: 303 });
    }

    case "generate_draft": {
      const result = traceCommandResult(traceSpan, await generateDraftCommand({
        ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
        payload: parsed.data.payload
      }));
      if (!result.ok) {
        if (isJson) {
          return NextResponse.json({ error: result.failure }, { status: 409 });
        }
        const redirect = safeRedirectUrl(request);
        redirect.searchParams.set("error", `${result.failure.code}: ${result.failure.message}`);
        return NextResponse.redirect(redirect, { status: 303 });
      }
      if (isJson) {
        return NextResponse.json({
          commandId: result.command.id,
          jobId: result.job.id,
          idempotencyKey: result.idempotencyKey,
          deduplicated: result.deduplicated
        });
      }
      return NextResponse.redirect(safeRedirectUrl(request), { status: 303 });
    }

    case "generate_warm_draft": {
      const result = traceCommandResult(traceSpan, await generateWarmDraftCommand({
        ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
        payload: parsed.data.payload
      }));
      if (!result.ok) {
        if (isJson) {
          return NextResponse.json({ error: result.failure }, { status: 409 });
        }
        const redirect = safeRedirectUrl(request);
        redirect.searchParams.set("error", `${result.failure.code}: ${result.failure.message}`);
        return NextResponse.redirect(redirect, { status: 303 });
      }
      if (isJson) {
        return NextResponse.json({
          commandId: result.command.id,
          jobId: result.job.id,
          idempotencyKey: result.idempotencyKey,
          deduplicated: result.deduplicated
        });
      }
      return NextResponse.redirect(safeRedirectUrl(request), { status: 303 });
    }

    case "request_ai_revise": {
      const result = traceCommandResult(traceSpan, await requestAiReviseCommand({
        ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
        payload: parsed.data.payload
      }));
      if (!result.ok) {
        if (isJson) {
          return NextResponse.json({ error: result.failure }, { status: 409 });
        }
        const redirect = safeRedirectUrl(request);
        redirect.searchParams.set("error", `${result.failure.code}: ${result.failure.message}`);
        return NextResponse.redirect(redirect, { status: 303 });
      }
      if (isJson) {
        return NextResponse.json({
          commandId: result.command.id,
          jobId: result.job.id,
          idempotencyKey: result.idempotencyKey,
          deduplicated: result.deduplicated
        });
      }
      return NextResponse.redirect(safeRedirectUrl(request), { status: 303 });
    }

    case "request_research_more": {
      const result = traceCommandResult(traceSpan, await requestResearchMoreCommand({
        ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
        payload: parsed.data.payload
      }));
      if (!result.ok) {
        if (isJson) {
          return NextResponse.json({ error: result.failure }, { status: 409 });
        }
        const redirect = safeRedirectUrl(request);
        redirect.searchParams.set("error", `${result.failure.code}: ${result.failure.message}`);
        return NextResponse.redirect(redirect, { status: 303 });
      }
      if (isJson) {
        return NextResponse.json({
          commandId: result.command.id,
          jobId: result.job.id,
          idempotencyKey: result.idempotencyKey,
          deduplicated: result.deduplicated
        });
      }
      return NextResponse.redirect(safeRedirectUrl(request), { status: 303 });
    }

    case "mark_claim_resolved": {
      const result = traceCommandResult(traceSpan, await markClaimResolvedCommand({
        ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
        payload: parsed.data.payload
      }));
      if (!result.ok) {
        if (isJson) {
          return NextResponse.json({ error: result.failure }, { status: 409 });
        }
        const redirect = safeRedirectUrl(request);
        redirect.searchParams.set("error", `${result.failure.code}: ${result.failure.message}`);
        return NextResponse.redirect(redirect, { status: 303 });
      }
      if (isJson) {
        return NextResponse.json({
          commandId: result.command.id,
          draftId: result.draftId,
          claimId: result.claimId,
          safety: result.safety,
          idempotencyKey: result.idempotencyKey,
          deduplicated: result.deduplicated
        });
      }
      return NextResponse.redirect(safeRedirectUrl(request), { status: 303 });
    }

    case "discard_draft": {
      const result = traceCommandResult(traceSpan, await discardDraftCommand({
        ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
        payload: parsed.data.payload
      }));
      if (!result.ok) {
        if (isJson) {
          return NextResponse.json({ error: result.failure }, { status: 409 });
        }
        const redirect = safeRedirectUrl(request);
        redirect.searchParams.set("error", `${result.failure.code}: ${result.failure.message}`);
        return NextResponse.redirect(redirect, { status: 303 });
      }
      if (isJson) {
        return NextResponse.json({
          commandId: result.command.id,
          draftId: result.draftId,
          idempotencyKey: result.idempotencyKey,
          deduplicated: result.deduplicated
        });
      }
      return NextResponse.redirect(safeRedirectUrl(request), { status: 303 });
    }

    case "refresh_research_snapshot": {
      const result = traceCommandResult(traceSpan, await refreshResearchSnapshotCommand({
        ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
        payload: parsed.data.payload
      }));
      if (!result.ok) {
        if (isJson) {
          return NextResponse.json({ error: result.failure }, { status: 409 });
        }
        const redirect = safeRedirectUrl(request);
        redirect.searchParams.set("error", `${result.failure.code}: ${result.failure.message}`);
        return NextResponse.redirect(redirect, { status: 303 });
      }
      if (isJson) {
        return NextResponse.json({
          commandId: result.command.id,
          jobId: result.job.id,
          idempotencyKey: result.idempotencyKey,
          deduplicated: result.deduplicated
        });
      }
      return NextResponse.redirect(safeRedirectUrl(request), { status: 303 });
    }

    case "record_draft_feedback": {
      const result = traceCommandResult(traceSpan, await recordDraftFeedbackCommand({
        ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
        payload: parsed.data.payload
      }));
      if (!result.ok) {
        if (isJson) {
          return NextResponse.json({ error: result.failure }, { status: 409 });
        }
        const redirect = safeRedirectUrl(request);
        redirect.searchParams.set("error", `${result.failure.code}: ${result.failure.message}`);
        return NextResponse.redirect(redirect, { status: 303 });
      }
      if (isJson) {
        return NextResponse.json({
          commandId: result.command.id,
          idempotencyKey: result.idempotencyKey,
          deduplicated: result.deduplicated
        });
      }
      return NextResponse.redirect(safeRedirectUrl(request), { status: 303 });
    }

    case "recompute_quality_score": {
      const result = traceCommandResult(traceSpan, await recomputeQualityScoreCommand({
        ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
        payload: parsed.data.payload
      }));
      if (!result.ok) {
        if (isJson) {
          return NextResponse.json({ error: result.failure }, { status: 409 });
        }
        const redirect = safeRedirectUrl(request);
        redirect.searchParams.set("error", `${result.failure.code}: ${result.failure.message}`);
        return NextResponse.redirect(redirect, { status: 303 });
      }
      if (isJson) {
        return NextResponse.json({
          commandId: result.command.id,
          idempotencyKey: result.idempotencyKey,
          deduplicated: result.deduplicated
        });
      }
      return NextResponse.redirect(safeRedirectUrl(request), { status: 303 });
    }

    case "resolve_policy_state": {
      const result = traceCommandResult(traceSpan, await resolvePolicyStateCommand({
        ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
        payload: parsed.data.payload
      }));
      if (!result.ok) {
        if (isJson) {
          return NextResponse.json({ error: result.failure }, { status: 409 });
        }
        const redirect = safeRedirectUrl(request);
        redirect.searchParams.set("error", `${result.failure.code}: ${result.failure.message}`);
        return NextResponse.redirect(redirect, { status: 303 });
      }
      if (isJson) {
        return NextResponse.json({
          commandId: result.command.id,
          policyStateId: result.policyStateId,
          deduplicated: result.deduplicated
        });
      }
      return NextResponse.redirect(safeRedirectUrl(request), { status: 303 });
    }

    case "run_campaign_discovery": {
      const result = traceCommandResult(traceSpan, await runCampaignDiscoveryCommand({
        ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
        payload: parsed.data.payload
      }));
      if (!result.ok) {
        if (isJson) {
          return NextResponse.json({ error: result.failure }, { status: 409 });
        }
        const redirect = safeRedirectUrl(request);
        redirect.searchParams.set("error", `${result.failure.code}: ${result.failure.message}`);
        return NextResponse.redirect(redirect, { status: 303 });
      }
      if (isJson) {
        return NextResponse.json({
          commandId: result.command.id,
          jobId: result.job.id,
          idempotencyKey: result.idempotencyKey,
          deduplicated: result.deduplicated
        });
      }
      return NextResponse.redirect(safeRedirectUrl(request), { status: 303 });
    }

    case "accept_discovery_candidate": {
      const result = traceCommandResult(traceSpan, await acceptDiscoveryCandidateCommand({
        ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
        payload: parsed.data.payload
      }));
      if (!result.ok) {
        if (isJson) {
          return NextResponse.json({ error: result.failure }, { status: 409 });
        }
        const redirect = safeRedirectUrl(request);
        redirect.searchParams.set("error", `${result.failure.code}: ${result.failure.message}`);
        return NextResponse.redirect(redirect, { status: 303 });
      }
      if (isJson) {
        return NextResponse.json({
          commandId: result.command.id,
          candidateId: result.candidateId,
          organizationId: result.organizationId,
          organizationCreated: result.organizationCreated,
          enrichmentJobId: result.enrichmentJobId,
          idempotencyKey: result.idempotencyKey,
          deduplicated: result.deduplicated
        });
      }
      return NextResponse.redirect(safeRedirectUrl(request), { status: 303 });
    }

    case "reject_discovery_candidate": {
      const result = traceCommandResult(traceSpan, await rejectDiscoveryCandidateCommand({
        ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
        payload: parsed.data.payload
      }));
      if (!result.ok) {
        if (isJson) {
          return NextResponse.json({ error: result.failure }, { status: 409 });
        }
        const redirect = safeRedirectUrl(request);
        redirect.searchParams.set("error", `${result.failure.code}: ${result.failure.message}`);
        return NextResponse.redirect(redirect, { status: 303 });
      }
      if (isJson) {
        return NextResponse.json({
          commandId: result.command.id,
          candidateId: result.candidateId,
          idempotencyKey: result.idempotencyKey,
          deduplicated: result.deduplicated
        });
      }
      return NextResponse.redirect(safeRedirectUrl(request), { status: 303 });
    }
  }
  } catch (err) {
    // Repository commands throw bare `Error` only for impossible states
    // (idempotency hash collision, dedup hit but job missing, etc.).
    // These are not operator-recoverable; surface a structured 500 with
    // a generic message and log the underlying error server-side so
    // tooling clients (which expect `{error:{code,message}}`) don't
    // break their parser on a Next.js framework HTML 500.
    logger.error({
      event: "command_unhandled_error",
      ...serializeError(err)
    });
    if (isJson) {
      return NextResponse.json(
        {
          error: {
            code: "internal_error",
            message: "Command failed due to an internal error. Please retry; if it persists, contact ops."
          }
        },
        { status: 500 }
      );
    }
    const redirect = safeRedirectUrl(request);
    redirect.searchParams.set(
      "error",
      "internal_error: command failed, please retry"
    );
    return NextResponse.redirect(redirect, { status: 303 });
  }
}

function traceCommandResult<T>(span: TraceSpanHandle | undefined, result: T): T {
  const correlationId = readCommandCorrelationId(result);
  if (correlationId) {
    span?.setBaggage("correlationId", correlationId);
    span?.setAttribute("correlationId", correlationId);
  }
  return result;
}

function readCommandCorrelationId(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const command = (result as { command?: unknown }).command;
  if (!command || typeof command !== "object") return null;
  const correlationId = (command as { correlationId?: unknown }).correlationId;
  return typeof correlationId === "string" && correlationId.length > 0
    ? correlationId
    : null;
}

function safeRedirectUrl(request: Request): URL {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  const browserOrigin = host ? `${proto}://${host}` : new URL(request.url).origin;
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const candidate = new URL(referer);
      if (candidate.host === host) {
        return candidate;
      }
    } catch {
      // fall through
    }
  }
  return new URL("/", browserOrigin);
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      errorMessage: error.message,
      errorStack: error.stack
    };
  }

  return { errorMessage: String(error) };
}

function resolveApproveFromEmail(): string | null {
  const value = process.env.RESEND_FROM_EMAIL?.trim().toLowerCase();
  return value || null;
}

function splitFormList(formData: FormData, name: string): string[] {
  const rawValues = formData.getAll(name)
    .flatMap((value) => String(value ?? "").split(/[\n,]/g))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return [...new Set(rawValues)];
}

function optionalPositiveInteger(formData: FormData, name: string): number | undefined {
  const raw = String(formData.get(name) ?? "").trim();
  if (!raw) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : undefined;
}

function optionalText(formData: FormData, name: string): string | undefined {
  const value = String(formData.get(name) ?? "").trim();
  return value || undefined;
}

function nullableText(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? "").trim();
  return value || null;
}

function nullableUuid(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? "").trim();
  return value || null;
}

function formDataToCommand(formData: FormData) {
  const commandType = String(formData.get("commandType") ?? formData.get("command_type") ?? "start_campaign");
  const actorId = String(formData.get("actorId") ?? "").trim();
  const base = actorId ? { actorId } : {};

  if (commandType === "update_campaign_scope") {
    const campaignId = String(formData.get("campaignId") ?? "").trim();
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
    return {
      commandType,
      ...base,
      payload: {
        campaignId,
        name: String(formData.get("name") ?? "").trim(),
        objective: String(formData.get("objective") ?? "").trim(),
        offerSummary: nullableText(formData, "offerSummary"),
        desiredCta: nullableText(formData, "desiredCta"),
        targetSegments: splitFormList(formData, "targetSegments"),
        forbiddenClaims: splitFormList(formData, "forbiddenClaims"),
        senderIdentityId: nullableUuid(formData, "senderIdentityId"),
        policyProfileId: nullableUuid(formData, "policyProfileId"),
        operatorNotes: nullableText(formData, "operatorNotes"),
        discoverySourceHints: splitFormList(formData, "discoverySourceHints"),
        discoveryExclusions: splitFormList(formData, "discoveryExclusions"),
        allowedRegions: splitFormList(formData, "allowedRegions"),
        maxOrganizationsToDiscover: optionalPositiveInteger(formData, "maxOrganizationsToDiscover") ?? 25,
        maxConcurrentEnrichments: optionalPositiveInteger(formData, "maxConcurrentEnrichments") ?? 3,
        maxConcurrentDrafts: optionalPositiveInteger(formData, "maxConcurrentDrafts") ?? 5,
        maxOpenDraftReviews: optionalPositiveInteger(formData, "maxOpenDraftReviews") ?? 25,
        cooldownBetweenDiscoverySeconds: optionalPositiveInteger(formData, "cooldownBetweenDiscoverySeconds") ?? 3600,
        allowGenericInboxFallback: formData.get("allowGenericInboxFallback") != null,
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    };
  }

  if (commandType === "create_draft") {
    const subject = String(formData.get("subject") ?? "").trim();
    const body = String(formData.get("body") ?? "").trim();
    const campaignId = String(formData.get("campaignId") ?? "").trim();
    const threadId = String(formData.get("threadId") ?? "").trim();
    const contactId = String(formData.get("contactId") ?? "").trim();
    const recipientEmail = String(formData.get("recipientEmail") ?? "").trim();
    const fromEmail = String(formData.get("fromEmail") ?? "").trim();
    const notes = String(formData.get("notes") ?? "").trim();
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
    return {
      commandType,
      ...base,
      payload: {
        subject,
        body,
        ...(campaignId ? { campaignId } : {}),
        ...(threadId ? { threadId } : {}),
        ...(contactId ? { contactId } : {}),
        ...(recipientEmail ? { recipientEmail } : {}),
        ...(fromEmail ? { fromEmail } : {}),
        ...(notes ? { notes } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    };
  }

  if (commandType === "request_manual_edit_save") {
    const draftId = String(formData.get("draftId") ?? "").trim();
    const expectedVersionRaw = String(formData.get("expectedVersion") ?? "").trim();
    const expectedVersion = Number.parseInt(expectedVersionRaw, 10);
    const subject = String(formData.get("subject") ?? "").trim();
    const body = String(formData.get("body") ?? "").trim();
    const notes = String(formData.get("notes") ?? "").trim();
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
    return {
      commandType,
      ...base,
      payload: {
        draftId,
        expectedVersion: Number.isFinite(expectedVersion) ? expectedVersion : 0,
        subject,
        body,
        ...(notes ? { notes } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    };
  }

  if (commandType === "pause_all_sends") {
    const reason = String(formData.get("reason") ?? "").trim();
    const expiresAt = String(formData.get("expiresAt") ?? "").trim();
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
    return {
      commandType,
      ...base,
      payload: {
        reason,
        ...(expiresAt ? { expiresAt } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    };
  }

  if (commandType === "resume_all_sends") {
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
    return {
      commandType,
      ...base,
      payload: {
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    };
  }

  if (commandType === "suppress_contact") {
    const email = String(formData.get("email") ?? "").trim();
    const reason = String(formData.get("reason") ?? "").trim();
    const source = String(formData.get("source") ?? "").trim();
    const notes = String(formData.get("notes") ?? "").trim();
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
    return {
      commandType,
      ...base,
      payload: {
        email,
        reason,
        ...(source ? { source } : {}),
        ...(notes ? { notes } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    };
  }

  if (commandType === "clear_suppression") {
    const suppressionId = String(formData.get("suppressionId") ?? "").trim();
    const reasonText = String(formData.get("reasonText") ?? "").trim();
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
    return {
      commandType,
      ...base,
      payload: {
        suppressionId,
        ...(reasonText ? { reasonText } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    };
  }

  if (commandType === "approve_contact_candidate") {
    const candidateId = String(formData.get("candidateId") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const fullName = String(formData.get("fullName") ?? "").trim();
    const roleTitle = String(formData.get("roleTitle") ?? "").trim();
    const notes = String(formData.get("notes") ?? "").trim();
    const confirmReattach = String(formData.get("confirmReattach") ?? "").trim() === "true";
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
    return {
      commandType,
      ...base,
      payload: {
        candidateId,
        ...(email ? { email } : {}),
        ...(fullName ? { fullName } : {}),
        ...(roleTitle ? { roleTitle } : {}),
        ...(notes ? { notes } : {}),
        ...(confirmReattach ? { confirmReattach } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    };
  }

  if (commandType === "reject_contact_candidate") {
    const candidateId = String(formData.get("candidateId") ?? "").trim();
    const reasonCode = String(formData.get("reasonCode") ?? "").trim();
    const reasonText = String(formData.get("reasonText") ?? "").trim();
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
    return {
      commandType,
      ...base,
      payload: {
        candidateId,
        ...(reasonCode ? { reasonCode } : {}),
        ...(reasonText ? { reasonText } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    };
  }

  if (commandType === "set_primary_contact") {
    const organizationId = String(formData.get("organizationId") ?? "").trim();
    const contactId = String(formData.get("contactId") ?? "").trim();
    const reasonText = String(formData.get("reasonText") ?? "").trim();
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
    return {
      commandType,
      ...base,
      payload: {
        organizationId,
        contactId,
        ...(reasonText ? { reasonText } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    };
  }

  if (commandType === "resolve_policy_state") {
    const policyStateId = String(formData.get("policyStateId") ?? "").trim();
    const reasonText = String(formData.get("reasonText") ?? "").trim();
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
    return {
      commandType,
      ...base,
      payload: {
        policyStateId,
        ...(reasonText ? { reasonText } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    };
  }

  if (commandType === "generate_draft") {
    const organizationId = String(formData.get("organizationId") ?? "").trim();
    const operatorBrief = String(formData.get("operatorBrief") ?? "").trim();
    const campaignId = String(formData.get("campaignId") ?? "").trim();
    const threadId = String(formData.get("threadId") ?? "").trim();
    const contactId = String(formData.get("contactId") ?? "").trim();
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
    return {
      commandType,
      ...base,
      payload: {
        organizationId,
        operatorBrief,
        ...(campaignId ? { campaignId } : {}),
        ...(threadId ? { threadId } : {}),
        ...(contactId ? { contactId } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    };
  }

  if (commandType === "generate_warm_draft") {
    const threadId = String(formData.get("threadId") ?? "").trim();
    const replyIntent = String(formData.get("replyIntent") ?? "").trim();
    const targetContactId = String(formData.get("targetContactId") ?? "").trim();
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
    return {
      commandType,
      ...base,
      payload: {
        threadId,
        replyIntent,
        ...(targetContactId ? { targetContactId } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    };
  }

  if (commandType === "request_ai_revise") {
    const draftId = String(formData.get("draftId") ?? "").trim();
    const expectedVersionRaw = String(formData.get("expectedVersion") ?? "").trim();
    const expectedVersion = Number.parseInt(expectedVersionRaw, 10);
    const operatorFeedback = String(formData.get("operatorFeedback") ?? "").trim();
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
    return {
      commandType,
      ...base,
      payload: {
        draftId,
        // Pass the parsed value through (NaN if missing/non-numeric). The Zod
        // schema rejects non-integers and values below 1, so a bad form yields
        // a clear 400 instead of silently defaulting to 0 → schema mismatch.
        expectedVersion,
        operatorFeedback,
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    };
  }

  if (commandType === "request_research_more") {
    const organizationId = String(formData.get("organizationId") ?? "").trim();
    const draftId = String(formData.get("draftId") ?? "").trim();
    const campaignId = String(formData.get("campaignId") ?? "").trim();
    const currentSnapshotId = String(formData.get("currentSnapshotId") ?? "").trim();
    const operatorNote = String(formData.get("operatorNote") ?? "").trim();
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
    // Multi-value field: <input name="unsupportedClaimIds" value="..."> repeated
    // for each checked claim. formData.getAll preserves the order the form
    // serialized them, which doesn't matter — the handler sorts before hashing.
    const unsupportedClaimIds = formData
      .getAll("unsupportedClaimIds")
      .map((v) => String(v).trim())
      .filter(Boolean);
    return {
      commandType,
      ...base,
      payload: {
        organizationId,
        ...(draftId ? { draftId } : {}),
        ...(campaignId ? { campaignId } : {}),
        ...(currentSnapshotId ? { currentSnapshotId } : {}),
        unsupportedClaimIds,
        ...(operatorNote ? { operatorNote } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    };
  }

  if (commandType === "record_draft_feedback") {
    const draftId = String(formData.get("draftId") ?? "").trim();
    const draftVersionRaw = String(formData.get("draftVersion") ?? "").trim();
    const draftVersion = Number.parseInt(draftVersionRaw, 10);
    const note = String(formData.get("note") ?? "").trim();
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
    // Multi-value: <input name="tags" value="..."> repeated per checked tag.
    const tags = formData
      .getAll("tags")
      .map((v) => String(v).trim())
      .filter(Boolean);
    return {
      commandType,
      ...base,
      payload: {
        draftId,
        draftVersion,
        tags,
        ...(note ? { note } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    };
  }

  if (commandType === "mark_claim_resolved") {
    const claimId = String(formData.get("claimId") ?? "").trim();
    const draftVersionRaw = String(formData.get("draftVersion") ?? "").trim();
    const draftVersion = Number.parseInt(draftVersionRaw, 10);
    const resolution = String(formData.get("resolution") ?? "").trim();
    const note = String(formData.get("note") ?? "").trim();
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
    return {
      commandType,
      ...base,
      payload: {
        claimId,
        draftVersion,
        resolution,
        note,
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    };
  }

  if (commandType === "discard_draft") {
    const draftId = String(formData.get("draftId") ?? "").trim();
    const expectedVersionRaw = String(formData.get("expectedVersion") ?? "").trim();
    const expectedVersion = Number.parseInt(expectedVersionRaw, 10);
    const reason = String(formData.get("reason") ?? "").trim();
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
    return {
      commandType,
      ...base,
      payload: {
        draftId,
        expectedVersion,
        reason,
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    };
  }

  if (commandType === "recompute_quality_score") {
    const draftId = String(formData.get("draftId") ?? "").trim();
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
    return {
      commandType,
      ...base,
      payload: {
        draftId,
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    };
  }

  if (commandType === "refresh_research_snapshot") {
    const organizationId = String(formData.get("organizationId") ?? "").trim();
    const prompt = String(formData.get("prompt") ?? "").trim();
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
    return {
      commandType,
      ...base,
      payload: {
        organizationId,
        prompt,
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    };
  }

  if (commandType === "approve_draft_for_send") {
    const draftId = String(formData.get("draftId") ?? "").trim();
    const draftVersionRaw = String(formData.get("draftVersion") ?? "").trim();
    const draftVersion = Number.parseInt(draftVersionRaw, 10);
    // Manual override (canonical §66): operator must explicitly tick each
    // overridable failure code AND supply a written reason. `acknowledgedCodes`
    // is multi-value (one input per code); `overrideReason` is a single text
    // field. Override is only included in payload if at least one code was
    // ticked — empty form means no override (the default for green-path
    // sends).
    const acknowledgedCodes = formData
      .getAll("acknowledgedCodes")
      .map((v) => String(v).trim())
      .filter(Boolean);
    const overrideReason = String(formData.get("overrideReason") ?? "").trim();
    const manualOverride = acknowledgedCodes.length > 0
      ? { manualOverride: { acknowledgedCodes, reason: overrideReason } }
      : {};
    return {
      commandType,
      ...base,
      payload: {
        draftId,
        draftVersion,
        ...manualOverride
      }
    };
  }

  if (commandType === "attach_inbound_to_thread") {
    const inboundMessageId = String(formData.get("inboundMessageId") ?? "");
    const threadId = String(formData.get("threadId") ?? "").trim();
    const createNewThreadRaw = String(formData.get("createNewThread") ?? "").trim();
    const createNewThread = createNewThreadRaw === "1" || createNewThreadRaw === "true";
    const campaignId = String(formData.get("campaignId") ?? "").trim();
    const organizationId = String(formData.get("organizationId") ?? "").trim();
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
    return {
      commandType,
      ...base,
      payload: {
        inboundMessageId,
        ...(threadId ? { threadId } : {}),
        ...(createNewThread ? { createNewThread: true } : {}),
        ...(campaignId ? { campaignId } : {}),
        ...(organizationId ? { organizationId } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    };
  }

  if (commandType === "merge_threads") {
    const primaryThreadId = String(formData.get("primaryThreadId") ?? "").trim();
    const secondaryThreadId = String(formData.get("secondaryThreadId") ?? "").trim();
    const reason = String(formData.get("reason") ?? "").trim();
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
    return {
      commandType,
      ...base,
      payload: {
        primaryThreadId,
        secondaryThreadId,
        reason,
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    };
  }

  if (commandType === "run_campaign_discovery") {
    const campaignId = String(formData.get("campaignId") ?? "").trim();
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
    return {
      commandType,
      ...base,
      payload: {
        campaignId,
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    };
  }

  if (commandType === "accept_discovery_candidate") {
    const candidateId = String(formData.get("candidateId") ?? "").trim();
    const organizationName = String(formData.get("organizationName") ?? "").trim();
    const domain = String(formData.get("domain") ?? "").trim();
    const countryCode = String(formData.get("countryCode") ?? "").trim();
    const linkToOrganizationId = String(formData.get("linkToOrganizationId") ?? "").trim();
    const notes = String(formData.get("notes") ?? "").trim();
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
    // Checkbox: present in the form data only when the operator ticked it.
    const skipEnrichment = formData.get("skipEnrichment") != null;
    return {
      commandType,
      ...base,
      payload: {
        candidateId,
        ...(organizationName ? { organizationName } : {}),
        ...(domain ? { domain } : {}),
        ...(countryCode ? { countryCode } : {}),
        ...(linkToOrganizationId ? { linkToOrganizationId } : {}),
        ...(skipEnrichment ? { skipEnrichment: true } : {}),
        ...(notes ? { notes } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    };
  }

  if (commandType === "reject_discovery_candidate") {
    const candidateId = String(formData.get("candidateId") ?? "").trim();
    const reasonCode = String(formData.get("reasonCode") ?? "").trim();
    const reasonText = String(formData.get("reasonText") ?? "").trim();
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
    return {
      commandType,
      ...base,
      payload: {
        candidateId,
        ...(reasonCode ? { reasonCode } : {}),
        ...(reasonText ? { reasonText } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    };
  }

  return {
    commandType: "start_campaign",
    ...base,
    payload: {
      name: String(formData.get("name") ?? ""),
      objective: String(formData.get("objective") ?? ""),
      ...(optionalText(formData, "offerSummary") ? { offerSummary: optionalText(formData, "offerSummary") } : {}),
      ...(optionalText(formData, "desiredCta") ? { desiredCta: optionalText(formData, "desiredCta") } : {}),
      targetSegments: splitFormList(formData, "targetSegments"),
      forbiddenClaims: splitFormList(formData, "forbiddenClaims"),
      ...(optionalText(formData, "senderIdentityId") ? { senderIdentityId: optionalText(formData, "senderIdentityId") } : {}),
      ...(optionalText(formData, "policyProfileId") ? { policyProfileId: optionalText(formData, "policyProfileId") } : {}),
      operatorNotes: String(formData.get("operatorNotes") ?? "").trim() || undefined,
      discoverySourceHints: splitFormList(formData, "discoverySourceHints"),
      discoveryExclusions: splitFormList(formData, "discoveryExclusions"),
      allowedRegions: splitFormList(formData, "allowedRegions"),
      maxOrganizationsToDiscover: optionalPositiveInteger(formData, "maxOrganizationsToDiscover") ?? 25,
      maxConcurrentEnrichments: optionalPositiveInteger(formData, "maxConcurrentEnrichments") ?? 3,
      maxConcurrentDrafts: optionalPositiveInteger(formData, "maxConcurrentDrafts") ?? 5,
      maxOpenDraftReviews: optionalPositiveInteger(formData, "maxOpenDraftReviews") ?? 25,
      cooldownBetweenDiscoverySeconds: optionalPositiveInteger(formData, "cooldownBetweenDiscoverySeconds") ?? 3600,
      allowGenericInboxFallback: formData.get("allowGenericInboxFallback") != null
    }
  };
}
