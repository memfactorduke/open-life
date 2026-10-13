import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  AgentWorkflowResponseSchema,
  AgentWorkflowCommandResponseSchema,
  SkillContentSchema,
  AgentWorkflowCommandSchema,
  TaskFileSchema,
  TaskFileAllocateSchema,
  TaskFileMutationSchema,
  TaskSchema,
  type TaskStep,
} from '@mems-life/domain';
import { request, RequestError } from '../api';
import './agent-workflow.css';
const Response = AgentWorkflowResponseSchema;
type Data = z.infer<typeof Response>;
const timestamp = (value: string) => new Date(value).toLocaleString();
const stateName = (value: string) =>
  ({
    'cancel-requested': 'Stop requested',
    'outcome-unknown': 'Outcome unknown',
    submitted: 'Needs your review',
    yielded: 'Needs you',
    expired: 'Connection expired',
    reconciled: 'Reconciled',
  })[value] ?? value;
export function AgentWorkflow({
  taskId,
  onChanged,
  onBlockedChange,
}: {
  taskId: string;
  onChanged?: () => void;
  onBlockedChange?: (blocked: boolean) => void;
}) {
  const [data, setData] = useState<Data | null>(null),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const pending = useRef<{ path: string; body: unknown } | null>(null),
    running = useRef(false);
  const [skillRevision, setSkillRevision] = useState(0),
    [bindingRevision, setBindingRevision] = useState(0);
  const [editingSkill, setEditingSkill] = useState(''),
    [name, setName] = useState(''),
    [instructions, setInstructions] = useState(''),
    [resources, setResources] = useState(''),
    [inputKeys, setInputKeys] = useState(''),
    [deliverable, setDeliverable] = useState('result'),
    [kind, setKind] = useState<'text' | 'link' | 'file'>('text');
  const [stepId, setStepId] = useState(''),
    [skillId, setSkillId] = useState(''),
    [version, setVersion] = useState(1),
    [inputs, setInputs] = useState<Record<string, string>>({}),
    [risk, setRisk] = useState<'none' | 'external-effect'>('none'),
    [retryable, setRetryable] = useState(true),
    [requiresApproval, setRequiresApproval] = useState(true);
  const [feedback, setFeedback] = useState<Record<string, string>>({}),
    [evidence, setEvidence] = useState<Record<string, string>>({}),
    [outcome, setOutcome] = useState<Record<string, 'performed' | 'not-performed'>>({}),
    [proof, setProof] = useState<Record<string, string>>({});
  const [stopped, setStopped] = useState<Record<string, string>>({}),
    [replacement, setReplacement] = useState<Record<string, boolean>>({});
  const [stale, setStale] = useState(false);
  const [file, setFile] = useState<File | null>(null),
    [files, setFiles] = useState<z.infer<typeof TaskFileSchema>[]>([]);
  const uploadPlan = useRef<{
    file: File;
    allocation: z.infer<typeof TaskFileAllocateSchema>;
    finalization: z.infer<typeof TaskFileMutationSchema>;
    stage: number;
    review: boolean;
  } | null>(null);
  const fileListSchema = z.object({ files: z.array(TaskFileSchema) });
  async function loadFiles() {
    const r = await request(`/api/tasks/${taskId}/files`, fileListSchema);
    setFiles(r.files);
  }
  async function upload(retry = false) {
    if (running.current || (!retry && pending.current) || !data) return;
    running.current = true;
    setBusy(true);
    try {
      if (!uploadPlan.current) {
        if (!file) throw new Error('Choose a file.');
        if (file.size < 1 || file.size > 50 * 1024 * 1024)
          throw new Error('Choose a nonempty file up to 50 MB.');
        const bytes = await file.arrayBuffer(),
          hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
            .map((v) => v.toString(16).padStart(2, '0'))
            .join('');
        uploadPlan.current = {
          file,
          allocation: TaskFileAllocateSchema.parse({
            operationId: crypto.randomUUID(),
            expectedRevision: data.task.revision,
            fileId: crypto.randomUUID(),
            name: file.name,
            size: file.size,
            sha256: hash,
            contentType:
              file.type ||
              ({
                md: 'text/markdown',
                txt: 'text/plain',
                pdf: 'application/pdf',
                png: 'image/png',
                jpg: 'image/jpeg',
                jpeg: 'image/jpeg',
                mp4: 'video/mp4',
              }[file.name.split('.').at(-1)?.toLowerCase() ?? ''] ??
                ''),
          }),
          finalization: { operationId: crypto.randomUUID(), expectedRevision: data.task.revision },
          stage: 0,
          review: false,
        };
      }
      const p = uploadPlan.current;
      if (p.review) {
        if (p.stage === 0)
          p.allocation = {
            ...p.allocation,
            operationId: crypto.randomUUID(),
            expectedRevision: data.task.revision,
          };
        p.finalization = { operationId: crypto.randomUUID(), expectedRevision: data.task.revision };
        p.review = false;
      }
      if (p.stage === 0) {
        await request(
          `/api/tasks/${taskId}/files`,
          z.object({ file: TaskFileSchema }).passthrough(),
          { method: 'POST', body: JSON.stringify(p.allocation) },
        );
        p.stage = 1;
      }
      if (p.stage === 1) {
        const r = await fetch(`/api/task-files/${p.allocation.fileId}/content`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: p.file,
        });
        if (!r.ok) throw new RequestError(r.status, 'The file transfer could not be confirmed.');
        p.stage = 2;
      }
      await request(
        `/api/task-files/${p.allocation.fileId}/finalize`,
        z.object({ file: TaskFileSchema, task: TaskSchema }).passthrough(),
        { method: 'POST', body: JSON.stringify(p.finalization) },
      );
      uploadPlan.current = null;
      setFile(null);
      await load();
      await loadFiles();
      onChanged?.();
      setNotice('Private file attached. Each upload is an immutable version.');
    } catch (e) {
      if (e instanceof RequestError && e.status >= 400 && e.status < 500 && uploadPlan.current) {
        uploadPlan.current.review = true;
        await load().catch(() => {});
      }
      setNotice(
        `${e instanceof Error ? e.message : 'File transfer interrupted.'} The selected file is retained.`,
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    void loadFiles().catch(() => {});
  }, [taskId]);
  const load = async () => {
    setData(Response.parse(await request(`/api/tasks/${taskId}/agent-workflow`, Response)));
  };
  useEffect(() => {
    let active = true;
    request(`/api/tasks/${taskId}/agent-workflow`, Response)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e) => {
        if (active) setNotice(e.message);
      });
    return () => {
      active = false;
    };
  }, [taskId]);
  async function send(path: string, body: unknown, retry = false) {
    if (running.current || (pending.current && !retry)) return;
    running.current = true;
    setBusy(true);
    setNotice('');
    pending.current = { path, body: structuredClone(body) };
    try {
      await request(
        path,
        path === '/api/agent-workflows/commands'
          ? AgentWorkflowCommandResponseSchema
          : z.object({}).passthrough(),
        { method: 'POST', body: JSON.stringify(body) },
      );
      pending.current = null;
      const saved = body as { type?: string; id?: string; expectedRevision?: number };
      if (saved.type === 'skill.put') {
        setEditingSkill(saved.id!);
        setSkillRevision((saved.expectedRevision ?? 0) + 1);
      }
      if (saved.type === 'binding.put') setBindingRevision((saved.expectedRevision ?? 0) + 1);
      setStale(false);
      await load();
      onChanged?.();
      setNotice(
        (body as { type?: string }).type === 'workflow.youtube-create'
          ? 'Fictional YouTube workflow created in Planned. Close this task to open the example.'
          : 'Saved.',
      );
    } catch (e) {
      if (e instanceof RequestError && e.status >= 400 && e.status < 500) {
        pending.current = null;
        if (e.status === 409) {
          setStale(true);
          await load().catch(() => {});
        }
        setNotice(
          `${e.message} Your input is still here.${e.status === 409 ? ' Review the refreshed information before saving again.' : ''}`,
        );
      } else setNotice(e instanceof Error ? e.message : 'The response could not be confirmed.');
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  const command = (body: unknown) => {
    try {
      const parsed = AgentWorkflowCommandSchema.parse({
        ...(body as object),
        operationId: crypto.randomUUID(),
      });
      void send('/api/agent-workflows/commands', parsed);
    } catch (e) {
      setNotice(
        e instanceof z.ZodError ? e.issues.map((v) => v.message).join(' ') : 'Check your input.',
      );
    }
  };
  const locked = busy || !!pending.current || !!uploadPlan.current || stale;
  useEffect(() => {
    onBlockedChange?.(locked);
    return () => onBlockedChange?.(false);
  }, [locked, onBlockedChange]);
  const selectedSkill = data?.skills.find((s) => s.id === skillId),
    selectedContent = selectedSkill?.versions[version - 1];
  function selectStep(step: TaskStep) {
    const b = data?.bindings.find((v) => v.stepId === step.id);
    setBindingRevision(b?.revision ?? 0);
    setStepId(step.id);
    setSkillId(b?.skillId ?? '');
    setVersion(b?.skillVersion ?? 1);
    setInputs(b?.inputs ?? {});
    setRisk(b?.risk ?? 'none');
    setRetryable(b?.retryable ?? true);
    setRequiresApproval(b?.requiresApproval ?? true);
  }
  function editSkill(id: string) {
    const s = data?.skills.find((v) => v.id === id),
      c = s?.versions.at(-1);
    setSkillRevision(s?.revision ?? 0);
    setEditingSkill(id);
    setName(c?.name ?? '');
    setInstructions(c?.instructions ?? '');
    setResources(c?.resources.join('\n') ?? '');
    setInputKeys(c?.inputKeys.join(', ') ?? '');
    setDeliverable(c?.requirements[0]?.key ?? 'result');
    setKind(c?.requirements[0]?.kind ?? 'text');
  }
  if (!data)
    return (
      <section className="agent-workflow">
        <h3>Agent work</h3>
        <p role="status">{notice || 'Opening workflow…'}</p>
        <button onClick={() => void load().catch((e) => setNotice(e.message))}>
          Reload workflow
        </button>
      </section>
    );
  return (
    <section className="agent-workflow" aria-label="Agent workflow">
      <h3>Agent work & review</h3>
      <p>
        Human and agent work belong to this same outcome. Released steps are available to connected
        workers; this app does not launch them.
      </p>
      {notice && (
        <p role="status" className="workflow-notice">
          {notice}
        </p>
      )}
      {pending.current && (
        <>
          <p>
            The last save has an uncertain response. Retry its exact original contents before making
            another change.
          </p>
          <button
            disabled={busy}
            onClick={() => {
              const p = pending.current;
              if (p) void send(p.path, p.body, true);
            }}
          >
            Retry the same change
          </button>
        </>
      )}
      {stale && editingSkill && (
        <section className="revision-review">
          <h4>Latest saved procedure</h4>
          <p>
            Revision {data.skills.find((s) => s.id === editingSkill)?.revision}. Your draft remains
            in the form below.
          </p>
          <pre>{data.skills.find((s) => s.id === editingSkill)?.versions.at(-1)?.instructions}</pre>
        </section>
      )}
      {stale && stepId && (
        <section className="revision-review">
          <h4>Latest saved binding</h4>
          <p>
            Procedure version{' '}
            {data.bindings.find((b) => b.stepId === stepId)?.skillVersion ?? 'not bound'}
          </p>
          {Object.entries(data.bindings.find((b) => b.stepId === stepId)?.inputs ?? {}).map(
            ([key, value]) => (
              <p key={key}>
                {key}: {value}
              </p>
            ),
          )}
        </section>
      )}
      {stale && (
        <button
          onClick={() => {
            setSkillRevision(data.skills.find((s) => s.id === editingSkill)?.revision ?? 0);
            setBindingRevision(data.bindings.find((b) => b.stepId === stepId)?.revision ?? 0);
            setStale(false);
          }}
        >
          I reviewed the refreshed information
        </button>
      )}
      <button
        className="secondary"
        disabled={locked}
        onClick={() => command({ type: 'workflow.youtube-create', taskId: crypto.randomUUID() })}
      >
        Create a fictional YouTube workflow in Planned
      </button>
      <div className="workflow-actions">
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void load().catch((e) => setNotice(e.message))}
        >
          Refresh workflow
        </button>
        {data.task.phase === 'planned' && (
          <button
            disabled={locked}
            onClick={() =>
              void send('/api/tasks/commands', {
                type: 'task.move',
                operationId: crypto.randomUUID(),
                taskId,
                expectedRevision: data.task.revision,
                phase: 'next',
                beforeTaskId: null,
              })
            }
          >
            Release to Next
          </button>
        )}
        <button
          className="secondary"
          disabled={locked}
          onClick={() =>
            void send('/api/tasks/commands', {
              type: 'task.pause',
              operationId: crypto.randomUUID(),
              taskId,
              expectedRevision: data.task.revision,
              paused: !data.task.paused,
            })
          }
        >
          {data.task.paused ? 'Resume work' : 'Pause work'}
        </button>
      </div>
      <p>
        {data.task.phase === 'planned'
          ? 'Planned · dormant'
          : data.task.paused
            ? 'Paused · no new work can begin'
            : 'Released · workers can claim ready steps'}
        . Pausing or requesting a stop cannot undo an action already performed.
      </p>
      <div className="workflow-steps">
        {data.steps.map((step) => {
          const binding = data.bindings.find((b) => b.stepId === step.id),
            attempts = data.attempts.filter((a) => a.stepId === step.id),
            results = data.results.filter((r) => r.stepId === step.id),
            blocked = step.content.dependencies.some((id) => {
              const d = data.steps.find((s) => s.id === id);
              return d?.status !== 'completed' && !(d?.status === 'skipped' && !d.content.required);
            });
          return (
            <article key={step.id}>
              <h4>{step.content.title}</h4>
              <p>
                {step.content.responsibility === 'human'
                  ? 'Human'
                  : step.content.responsibility === 'agent'
                    ? 'Agent'
                    : 'Human or agent'}{' '}
                ·{' '}
                {step.status === 'completed'
                  ? 'Completed'
                  : blocked
                    ? 'Waiting for prerequisites'
                    : step.content.responsibility === 'human'
                      ? 'Needs you'
                      : binding
                        ? 'Procedure ready'
                        : 'Needs a procedure'}
              </p>
              <p>{step.content.instructions}</p>
              {step.content.responsibility !== 'human' && (
                <>
                  <p>
                    {binding
                      ? `Procedure version ${binding.skillVersion} · ${binding.requirements.map((r) => `${r.key} (${r.kind})`).join(', ')}`
                      : 'Select instructions, inputs and a deliverable before releasing this step.'}
                  </p>
                  <button className="secondary" disabled={locked} onClick={() => selectStep(step)}>
                    Set procedure for {step.content.title}
                  </button>
                </>
              )}
              {attempts.map((a, index) => (
                <details key={a.id} open={index === attempts.length - 1}>
                  <summary>
                    Attempt {index + 1} · {stateName(a.effectiveStatus)}
                  </summary>
                  <p>
                    Started {timestamp(a.createdAt)} · Updated {timestamp(a.updatedAt)} · Connection
                    lease until {timestamp(a.expiresAt)}
                  </p>
                  <p>Worker: {a.actorId}</p>
                  <p>
                    Procedure used: {a.snapshot.skill.name} · version{' '}
                    {a.snapshot.binding.skillVersion}
                  </p>
                  <pre>{a.snapshot.skill.instructions}</pre>
                  <dl>
                    {Object.entries(a.snapshot.binding.inputs).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <p>
                    Expected at execution:{' '}
                    {a.snapshot.binding.requirements.map((r) => `${r.key} (${r.kind})`).join(', ')}
                  </p>
                  {a.snapshot.skill.resources.map((url) => (
                    <p key={url}>
                      <a href={url} target="_blank" rel="noreferrer">
                        Resource used: {url}
                      </a>
                    </p>
                  ))}
                  {a.progress.map((p, i) => (
                    <p key={i}>
                      {timestamp(p.at)} · {p.message}
                    </p>
                  ))}
                  {a.error && <p>{a.error}</p>}
                  {a.reconciliation?.outcome === 'performed' &&
                    !a.reconciliation.replacementAuthorized && (
                      <p>
                        Existing external effect preserved. A replacement requires explicit
                        permission.
                      </p>
                    )}
                  {a.reconciliation && (
                    <p>
                      Verified{' '}
                      {a.reconciliation.outcome === 'performed' ? 'performed' : 'not performed'}:{' '}
                      {a.reconciliation.evidence}
                    </p>
                  )}
                  {['running', 'cancel-requested'].includes(a.effectiveStatus) && (
                    <>
                      <label>
                        Reason for stopping
                        <input
                          value={feedback[a.id] ?? ''}
                          onChange={(e) => setFeedback({ ...feedback, [a.id]: e.target.value })}
                        />
                      </label>
                      <button
                        disabled={
                          locked ||
                          !feedback[a.id]?.trim() ||
                          a.effectiveStatus === 'cancel-requested'
                        }
                        onClick={() =>
                          command({
                            type: 'attempt.cancel',
                            taskId,
                            stepId: step.id,
                            attemptId: a.id,
                            reason: feedback[a.id],
                          })
                        }
                      >
                        Request worker stop
                      </button>
                      <p>
                        A stop request is cooperative. Wait for confirmation or verify the external
                        destination.
                      </p>
                    </>
                  )}
                  {a.effectiveStatus === 'outcome-unknown' && (
                    <div className="workflow-recovery">
                      <p>
                        The connection ended without a confirmed outcome. A timeout does not prove
                        an upload stopped. Inspect the destination before retrying.
                      </p>
                      <label>
                        Verified outcome
                        <select
                          value={outcome[a.id] ?? ''}
                          onChange={(e) =>
                            setOutcome({
                              ...outcome,
                              [a.id]: e.target.value as 'performed' | 'not-performed',
                            })
                          }
                        >
                          <option value="">Choose after checking</option>
                          <option value="performed">The action occurred</option>
                          <option value="not-performed">The action did not occur</option>
                        </select>
                      </label>
                      <label>
                        Evidence from your check
                        <textarea
                          value={evidence[a.id] ?? ''}
                          onChange={(e) => setEvidence({ ...evidence, [a.id]: e.target.value })}
                        />
                      </label>
                      {outcome[a.id] === 'performed' &&
                        a.snapshot.binding.requirements.map((r) => (
                          <label key={r.key}>
                            Verified {r.key}{' '}
                            {r.kind === 'file'
                              ? 'private file version ID'
                              : r.kind === 'link'
                                ? 'receipt link'
                                : 'result text'}
                            <textarea
                              value={proof[`${a.id}:${r.key}`] ?? ''}
                              onChange={(e) =>
                                setProof({ ...proof, [`${a.id}:${r.key}`]: e.target.value })
                              }
                            />
                          </label>
                        ))}
                      <label>
                        Evidence that the previous worker stopped
                        <textarea
                          value={stopped[a.id] ?? ''}
                          onChange={(e) => setStopped({ ...stopped, [a.id]: e.target.value })}
                        />
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={replacement[a.id] ?? false}
                          onChange={(e) =>
                            setReplacement({ ...replacement, [a.id]: e.target.checked })
                          }
                        />
                        Authorize a replacement attempt after verifying the prior worker stopped
                      </label>
                      <button
                        disabled={locked || !outcome[a.id] || !evidence[a.id]?.trim()}
                        onClick={() => {
                          try {
                            command({
                              type: 'attempt.reconcile',
                              taskId,
                              stepId: step.id,
                              attemptId: a.id,
                              outcome: outcome[a.id],
                              evidence: evidence[a.id],
                              workerStoppedEvidence: stopped[a.id] || undefined,
                              allowReplacement: replacement[a.id] ?? false,
                              artifacts:
                                outcome[a.id] === 'performed'
                                  ? a.snapshot.binding.requirements
                                      .filter(
                                        (r) => r.required || proof[`${a.id}:${r.key}`]?.trim(),
                                      )
                                      .map((r) => ({
                                        key: r.key,
                                        kind: r.kind,
                                        ...(r.kind === 'text'
                                          ? { text: proof[`${a.id}:${r.key}`] }
                                          : r.kind === 'link'
                                            ? {
                                                url: proof[`${a.id}:${r.key}`],
                                                description: evidence[a.id],
                                              }
                                            : {
                                                fileId: proof[`${a.id}:${r.key}`],
                                                description: evidence[a.id],
                                              }),
                                      }))
                                  : [],
                            });
                          } catch {
                            setNotice(
                              'Check the verified deliverables format. Your evidence is still here.',
                            );
                          }
                        }}
                      >
                        Save verified outcome
                      </button>
                    </div>
                  )}
                  {['failed', 'expired', 'yielded', 'reconciled'].includes(a.effectiveStatus) && (
                    <p>
                      {binding?.retryable
                        ? 'A connected worker can make another attempt when the step is eligible. Previous attempts remain here.'
                        : 'Automatic retry is disabled for this procedure.'}
                    </p>
                  )}
                </details>
              ))}
              {results.map((result) => (
                <section className="workflow-result" key={result.id}>
                  <h5>
                    Result version {result.version}
                    {result.approvedAt ? ' · Approved' : ''}
                  </h5>
                  <p>{result.summary}</p>
                  <p>Submitted {timestamp(result.createdAt)}</p>
                  {result.artifacts.map((artifact) => (
                    <div key={artifact.key}>
                      <strong>{artifact.key}</strong>
                      {artifact.kind === 'text' ? (
                        <pre>{artifact.text}</pre>
                      ) : artifact.kind === 'link' ? (
                        <p>
                          <a href={artifact.url} target="_blank" rel="noreferrer">
                            {artifact.description || 'Open result'}
                          </a>
                        </p>
                      ) : (
                        <p>
                          <a
                            href={`/api/task-files/${artifact.fileId}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {artifact.description || 'Open private file'}
                          </a>
                          <small>Immutable file {artifact.fileId}</small>
                        </p>
                      )}
                    </div>
                  ))}
                  {result.feedback && <p>Revision requested: {result.feedback}</p>}
                  <p>
                    Opening a result does not approve it. Approval accepts this exact version; it
                    does not mark a separate human action complete.
                  </p>
                  <button
                    disabled={locked || !!result.approvedAt || result !== results.at(-1)}
                    onClick={() =>
                      command({
                        type: 'result.approve',
                        taskId,
                        stepId: step.id,
                        resultId: result.id,
                        expectedVersion: result.version,
                      })
                    }
                  >
                    Approve version {result.version}
                  </button>
                  <label>
                    Changes for version {result.version}
                    <textarea
                      value={feedback[result.id] ?? ''}
                      onChange={(e) => setFeedback({ ...feedback, [result.id]: e.target.value })}
                    />
                  </label>
                  <button
                    className="secondary"
                    disabled={locked || !feedback[result.id]?.trim() || result !== results.at(-1)}
                    onClick={() =>
                      command({
                        type: 'result.request-changes',
                        taskId,
                        stepId: step.id,
                        resultId: result.id,
                        expectedVersion: result.version,
                        feedback: feedback[result.id],
                      })
                    }
                  >
                    Request revisions to version {result.version}
                  </button>
                </section>
              ))}
            </article>
          );
        })}
      </div>
      {stepId && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!selectedContent) return;
            command({
              type: 'binding.put',
              taskId,
              stepId,
              expectedRevision: bindingRevision,
              skillId,
              skillVersion: version,
              inputs: Object.fromEntries(
                selectedContent.inputKeys.map((k) => [k, inputs[k] ?? '']),
              ),
              requirements: selectedContent.requirements,
              risk,
              retryable,
              requiresApproval,
            });
          }}
        >
          <h4>Procedure for {data.steps.find((s) => s.id === stepId)?.content.title}</h4>
          <fieldset disabled={locked}>
            <label>
              Reusable procedure
              <select
                aria-label="Reusable procedure"
                value={skillId}
                required
                onChange={(e) => {
                  setSkillId(e.target.value);
                  setVersion(1);
                  setInputs({});
                }}
              >
                <option value="">Choose a procedure</option>
                {data.skills.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.versions.at(-1)?.name}
                  </option>
                ))}
              </select>
            </label>
            {selectedSkill && (
              <label>
                Procedure version
                <select value={version} onChange={(e) => setVersion(Number(e.target.value))}>
                  {selectedSkill.versions.map((v, i) => (
                    <option key={i} value={i + 1}>
                      {i + 1} · {v.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {selectedContent && (
              <>
                <pre>{selectedContent.instructions}</pre>
                {selectedContent.inputKeys.map((key) => (
                  <label key={key}>
                    {key}
                    <textarea
                      required
                      value={inputs[key] ?? ''}
                      onChange={(e) => setInputs({ ...inputs, [key]: e.target.value })}
                    />
                  </label>
                ))}
                <p>
                  Expected deliverable:{' '}
                  {selectedContent.requirements
                    .map((r) => `${r.key} · ${r.kind}${r.required ? ' · required' : ''}`)
                    .join('; ')}
                </p>
              </>
            )}
            <label>
              Does this step change an external destination?
              <select value={risk} onChange={(e) => setRisk(e.target.value as typeof risk)}>
                <option value="none">No external action</option>
                <option value="external-effect">Yes, such as uploading a file</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={retryable}
                onChange={(e) => setRetryable(e.target.checked)}
              />
              Allow another attempt after confirmed failure
            </label>
            <label>
              <input
                type="checkbox"
                checked={requiresApproval}
                onChange={(e) => setRequiresApproval(e.target.checked)}
              />
              Require approval of the exact result before continuing
            </label>
            <button disabled={!selectedContent}>Save procedure binding</button>
            <button type="button" className="secondary" onClick={() => setStepId('')}>
              Close procedure
            </button>
          </fieldset>
        </form>
      )}
      <section>
        <h4>Private task files</h4>
        <p>
          Attach scripts, images, PDF documents or MP4 previews up to 50 MB. Each file is a separate
          immutable version.
        </p>
        <label>
          File to attach
          <input
            type="file"
            accept="text/plain,text/markdown,application/pdf,image/png,image/jpeg,video/mp4"
            disabled={busy || !!pending.current || !!uploadPlan.current}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button
          disabled={busy || !!pending.current || (!file && !uploadPlan.current)}
          onClick={() => void upload(!!uploadPlan.current)}
        >
          {uploadPlan.current?.review
            ? 'Review refreshed task and resume file transfer'
            : uploadPlan.current
              ? 'Retry the same file transfer'
              : 'Attach private file'}
        </button>
        {files
          .filter((f) => f.status === 'finalized' && !f.detachedAt)
          .map((f) => (
            <p key={f.id}>
              <a href={`/api/task-files/${f.id}`} target="_blank" rel="noreferrer">
                {f.name}
              </a>{' '}
              · {f.contentType} · {f.size.toLocaleString()} bytes
              <small>Immutable file version {f.id}</small>
            </p>
          ))}
      </section>
      <details>
        <summary>Reusable procedures</summary>
        <p>
          Instructions and resource links guide the worker. They do not grant account access or run
          code here.
        </p>
        <label>
          Edit procedure
          <select value={editingSkill} onChange={(e) => editSkill(e.target.value)}>
            <option value="">New procedure</option>
            {data.skills.map((s) => (
              <option key={s.id} value={s.id}>
                {s.versions.at(-1)?.name}
              </option>
            ))}
          </select>
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            try {
              const old = data.skills.find((s) => s.id === editingSkill);
              const content = SkillContentSchema.parse({
                name,
                instructions,
                resources: resources
                  .split('\n')
                  .map((v) => v.trim())
                  .filter(Boolean),
                inputKeys: inputKeys
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean),
                requirements: [
                  { key: deliverable, kind, required: true },
                  ...(old?.versions.at(-1)?.requirements.slice(1) ?? []),
                ],
              });
              command({
                type: 'skill.put',
                id: editingSkill || crypto.randomUUID(),
                expectedRevision: skillRevision,
                content,
              });
            } catch (error) {
              setNotice(error instanceof Error ? error.message : 'Check the procedure.');
            }
          }}
        >
          <fieldset disabled={locked}>
            <label>
              Procedure name
              <input
                required
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Bounded instructions
              <textarea
                required
                rows={5}
                maxLength={20000}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </label>
            <label>
              Resource links (one per line)
              <textarea value={resources} onChange={(e) => setResources(e.target.value)} />
            </label>
            <label>
              Required input names (comma separated)
              <input value={inputKeys} onChange={(e) => setInputKeys(e.target.value)} />
            </label>
            <label>
              Deliverable name
              <input
                required
                value={deliverable}
                onChange={(e) => setDeliverable(e.target.value)}
              />
            </label>
            <label>
              Deliverable type
              <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                <option value="text">Text</option>
                <option value="link">Link</option>
                <option value="file">Private file</option>
              </select>
            </label>
            <button>Save new procedure version</button>
          </fieldset>
        </form>
      </details>
    </section>
  );
}
