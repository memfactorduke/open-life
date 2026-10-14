import React, { useEffect, useRef, useState } from 'react';
import { Linking, View, Modal, ScrollView, Image, useWindowDimensions } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import {
  AgentWorkflowResponseSchema,
  AgentWorkflowCommandSchema,
  AgentWorkflowCommandResponseSchema,
  SkillContentSchema,
  TaskFileAllocateSchema,
  TaskFileSchema,
  TaskSchema,
  type AgentWorkflowResponse,
  type TaskStep,
} from '@mems-life/domain';
import { type InstallationClient, RequestRejectedError } from '../client';
import { Action, Body, Card, Choice, Field, Heading, Disclosure } from '../ui';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { messageOf } from './helpers';
const stamp = (v: string) => new Date(v).toLocaleString();
const names: Record<string, string> = {
  running: 'Running',
  failed: 'Failed',
  cancelled: 'Stopped',
  'cancel-requested': 'Stop requested',
  'outcome-unknown': 'Outcome unknown',
  submitted: 'Needs your review',
  yielded: 'Needs you',
  expired: 'Connection expired',
  reconciled: 'Reconciled',
};
export function AgentWorkflow({
  client,
  taskId,
  onChanged,
  onBlockedChange,
  configurationInitiallyOpen = false,
}: {
  client: InstallationClient;
  taskId: string;
  onChanged?: () => void;
  onBlockedChange?: (blocked: boolean) => void;
  configurationInitiallyOpen?: boolean;
}) {
  const [configurationOpen, setConfigurationOpen] = useState(configurationInitiallyOpen);
  useEffect(() => setConfigurationOpen(configurationInitiallyOpen), [configurationInitiallyOpen]);
  const insets = React.useContext(SafeAreaInsetsContext);
  const width = useWindowDimensions().width;
  const [preview, setPreview] = useState<{
    id: string;
    text?: string;
    cookie?: string;
    type?: string;
  } | null>(null);
  async function openFile(id: string) {
    try {
      const cookie = await client.auth.getCookie();
      const r = await fetch(`${client.baseURL}/api/task-files/${id}`, {
        headers: { Cookie: cookie ?? '' },
        credentials: 'omit',
      });
      if (!r.ok)
        throw new Error(
          'The private file could not be opened. Sign in again or refresh the result.',
        );
      const type = r.headers.get('content-type') ?? '';
      if (type.startsWith('text/')) {
        setPreview({ id, text: await r.text(), type });
      } else if (type.startsWith('image/')) {
        setPreview({ id, cookie: cookie ?? '', type });
      } else {
        setNotice(
          'This file is available in the authenticated web interface. Native preview supports text and images; PDF and video playback are not available yet.',
        );
      }
    } catch (e) {
      setNotice(messageOf(e));
    }
  }
  const [data, setData] = useState<AgentWorkflowResponse | null>(null),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [stale, setStale] = useState(false);
  const pending = useRef<{ path: string; body: unknown } | null>(null),
    running = useRef(false);
  const [skillRevision, setSkillRevision] = useState(0),
    [bindingRevision, setBindingRevision] = useState(0);
  const [editor, setEditor] = useState(false),
    [editingSkill, setEditingSkill] = useState(''),
    [name, setName] = useState(''),
    [instructions, setInstructions] = useState(''),
    [resources, setResources] = useState(''),
    [inputNames, setInputNames] = useState(''),
    [deliverable, setDeliverable] = useState('result'),
    [kind, setKind] = useState<'text' | 'link' | 'file'>('text');
  const [stepId, setStepId] = useState(''),
    [skillId, setSkillId] = useState(''),
    [version, setVersion] = useState('1'),
    [inputs, setInputs] = useState<Record<string, string>>({}),
    [risk, setRisk] = useState<'none' | 'external-effect'>('none'),
    [retryable, setRetryable] = useState<'yes' | 'no'>('yes'),
    [approval, setApproval] = useState<'yes' | 'no'>('yes');
  const [stopped, setStopped] = useState<Record<string, string>>({}),
    [replacement, setReplacement] = useState<Record<string, 'yes' | 'no'>>({});
  const [feedback, setFeedback] = useState<Record<string, string>>({}),
    [evidence, setEvidence] = useState<Record<string, string>>({}),
    [outcomes, setOutcomes] = useState<Record<string, 'performed' | 'not-performed'>>({}),
    [receipt, setReceipt] = useState<Record<string, string>>({});
  const [fileName, setFileName] = useState('fictional-script.txt'),
    [fileText, setFileText] = useState('');
  const [document, setDocument] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  async function pickFile() {
    try {
      const r = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: [
          'text/plain',
          'text/markdown',
          'application/pdf',
          'image/png',
          'image/jpeg',
          'video/mp4',
        ],
      });
      if (!r.canceled) {
        const f = r.assets[0];
        if (f && f.size && f.size > 50 * 1024 * 1024) throw new Error('Choose a file up to 50 MB.');
        setDocument(f ?? null);
      }
    } catch (e) {
      setNotice(messageOf(e));
    }
  }
  const uploadPlan = useRef<{
    allocation: ReturnType<typeof TaskFileAllocateSchema.parse>;
    finalization: { operationId: string; expectedRevision: number };
    text: string | ArrayBuffer;
    stage: number;
    review: boolean;
  } | null>(null);
  const [files, setFiles] = useState<ReturnType<typeof TaskFileSchema.parse>[]>([]);
  async function loadFiles() {
    const response = (await client.request(`/api/tasks/${taskId}/files`)) as { files: unknown[] };
    setFiles(response.files.map((f) => TaskFileSchema.parse(f)));
  }
  async function uploadText() {
    if (running.current || pending.current || !data) return;
    running.current = true;
    setBusy(true);
    try {
      if (!uploadPlan.current) {
        const body = document ? await new File(document.uri).arrayBuffer() : fileText;
        const sha256 =
          typeof body === 'string'
            ? await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, body)
            : Array.from(
                new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, body)),
              )
                .map((v) => v.toString(16).padStart(2, '0'))
                .join('');
        const size =
          typeof body === 'string'
            ? encodeURIComponent(body).replace(/%[A-F\d]{2}|./gi, 'x').length
            : body.byteLength;
        uploadPlan.current = {
          text: body,
          allocation: TaskFileAllocateSchema.parse({
            operationId: Crypto.randomUUID(),
            expectedRevision: data.task.revision,
            fileId: Crypto.randomUUID(),
            name: document?.name ?? fileName,
            size,
            sha256,
            contentType: document?.mimeType ?? 'text/plain',
          }),
          finalization: { operationId: Crypto.randomUUID(), expectedRevision: data.task.revision },
          stage: 0,
          review: false,
        };
      }
      const p = uploadPlan.current;
      if (p.review) {
        if (p.stage === 0)
          p.allocation = {
            ...p.allocation,
            operationId: Crypto.randomUUID(),
            expectedRevision: data.task.revision,
          };
        p.finalization = { operationId: Crypto.randomUUID(), expectedRevision: data.task.revision };
        p.review = false;
      }
      if (p.stage === 0) {
        const r = (await client.request(`/api/tasks/${taskId}/files`, p.allocation, 'POST')) as {
          file: unknown;
        };
        TaskFileSchema.parse(r.file);
        p.stage = 1;
      }
      if (p.stage === 1) {
        const cookie = await client.auth.getCookie();
        const r = await fetch(`${client.baseURL}/api/task-files/${p.allocation.fileId}/content`, {
          method: 'PUT',
          credentials: 'omit',
          headers: {
            Cookie: cookie ?? '',
            Origin: 'memslife://',
            'Content-Type': 'application/octet-stream',
          },
          body: p.text,
        });
        if (!r.ok)
          throw new RequestRejectedError(r.status, 'Private file transfer could not be confirmed.');
        p.stage = 2;
      }
      const result = (await client.request(
        `/api/task-files/${p.allocation.fileId}/finalize`,
        p.finalization,
        'POST',
      )) as { file: unknown; task: unknown };
      TaskFileSchema.parse(result.file);
      TaskSchema.parse(result.task);
      uploadPlan.current = null;
      setFileText('');
      setDocument(null);
      await load();
      await loadFiles();
      onChanged?.();
      setNotice('Private file version attached.');
    } catch (e) {
      if (
        e instanceof RequestRejectedError &&
        e.status >= 400 &&
        e.status < 500 &&
        uploadPlan.current
      ) {
        uploadPlan.current.review = true;
        await load().catch(() => {});
      }
      setNotice(`${messageOf(e)} Your file contents are retained.`);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    void loadFiles().catch(() => {});
  }, [taskId, client]);
  async function load() {
    setData(
      AgentWorkflowResponseSchema.parse(
        await client.request(`/api/tasks/${taskId}/agent-workflow`),
      ),
    );
  }
  useEffect(() => {
    let active = true;
    client
      .request(`/api/tasks/${taskId}/agent-workflow`)
      .then((v) => {
        if (active) setData(AgentWorkflowResponseSchema.parse(v));
      })
      .catch((e) => {
        if (active) setNotice(messageOf(e));
      });
    return () => {
      active = false;
    };
  }, [taskId, client]);
  async function send(path: string, body: unknown, retry = false) {
    if (running.current || (pending.current && !retry)) return;
    running.current = true;
    setBusy(true);
    setNotice('');
    pending.current = { path, body: JSON.parse(JSON.stringify(body)) };
    try {
      const response = await client.request(path, body, 'POST');
      if (path === '/api/agent-workflows/commands')
        AgentWorkflowCommandResponseSchema.parse(response);
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
      if (e instanceof RequestRejectedError && e.status >= 400 && e.status < 500) {
        pending.current = null;
        if (e.status === 409) {
          setStale(true);
          await load().catch(() => {});
        }
      }
      setNotice(`${messageOf(e)} Your input is still here.`);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  function command(body: Record<string, unknown>) {
    try {
      void send(
        '/api/agent-workflows/commands',
        AgentWorkflowCommandSchema.parse({ ...body, operationId: Crypto.randomUUID() }),
      );
    } catch (e) {
      setNotice(messageOf(e));
    }
  }
  const locked = busy || !!pending.current || !!uploadPlan.current || stale,
    skill = data?.skills.find((s) => s.id === skillId),
    content = skill?.versions[Number(version) - 1];
  useEffect(() => {
    onBlockedChange?.(locked);
    return () => onBlockedChange?.(false);
  }, [locked, onBlockedChange]);
  function selectStep(step: TaskStep) {
    const b = data?.bindings.find((b) => b.stepId === step.id);
    setBindingRevision(b?.revision ?? 0);
    setStepId(step.id);
    setSkillId(b?.skillId ?? '');
    setVersion(String(b?.skillVersion ?? 1));
    setInputs(b?.inputs ?? {});
    setRisk(b?.risk ?? 'none');
    setRetryable(b?.retryable === false ? 'no' : 'yes');
    setApproval(b?.requiresApproval === false ? 'no' : 'yes');
  }
  function editSkill(id: string) {
    const s = data?.skills.find((s) => s.id === id),
      c = s?.versions.at(-1);
    setSkillRevision(s?.revision ?? 0);
    setEditingSkill(id);
    setName(c?.name ?? '');
    setInstructions(c?.instructions ?? '');
    setResources(c?.resources.join('\n') ?? '');
    setInputNames(c?.inputKeys.join(', ') ?? '');
    setDeliverable(c?.requirements[0]?.key ?? 'result');
    setKind(c?.requirements[0]?.kind ?? 'text');
    setEditor(true);
  }
  if (!data)
    return (
      <Card>
        <Heading>Agent work</Heading>
        <Body>{notice || 'Opening workflow…'}</Body>
        <Action
          title="Reload workflow"
          onPress={() => void load().catch((e) => setNotice(messageOf(e)))}
        />
      </Card>
    );
  return (
    <View style={{ gap: 12 }}>
      <Modal
        visible={!!preview}
        onRequestClose={() => setPreview(null)}
        presentationStyle="pageSheet"
      >
        <ScrollView
          contentContainerStyle={{
            paddingTop: (insets?.top ?? 20) + 16,
            paddingBottom: (insets?.bottom ?? 16) + 16,
            paddingHorizontal: 20,
            gap: 12,
          }}
        >
          <Heading>Private result version</Heading>
          <Body>{preview?.id}</Body>
          <Action title="Close private result" onPress={() => setPreview(null)} />
          {preview?.text && <Body>{preview.text}</Body>}
          {preview?.type?.startsWith('image/') && (
            <Image
              accessibilityLabel="Private result image"
              resizeMode="contain"
              style={{ width: Math.min(width - 40, 900), height: 500 }}
              source={{
                uri: `${client.baseURL}/api/task-files/${preview.id}`,
                headers: { Cookie: preview.cookie ?? '' },
              }}
            />
          )}
        </ScrollView>
      </Modal>
      <Heading compact>Agent work & review</Heading>

      {notice && <Body error>{notice}</Body>}
      {pending.current && (
        <>
          <Body>
            The save response is uncertain. Retry its original contents before making another
            change.
          </Body>
          <Action
            title="Retry the same change"
            busy={busy}
            onPress={() => {
              const p = pending.current;
              if (p) void send(p.path, p.body, true);
            }}
          />
        </>
      )}
      {stale && editingSkill && (
        <Card>
          <Heading>Latest saved procedure</Heading>
          <Body>
            Revision {data.skills.find((s) => s.id === editingSkill)?.revision}. Your draft remains
            below.
          </Body>
          <Body>
            {data.skills.find((s) => s.id === editingSkill)?.versions.at(-1)?.instructions}
          </Body>
        </Card>
      )}
      {stale && stepId && (
        <Card>
          <Heading>Latest saved binding</Heading>
          <Body>
            Procedure version{' '}
            {data.bindings.find((b) => b.stepId === stepId)?.skillVersion ?? 'not bound'}
          </Body>
          {Object.entries(data.bindings.find((b) => b.stepId === stepId)?.inputs ?? {}).map(
            ([key, value]) => (
              <Body key={key}>
                {key}: {value}
              </Body>
            ),
          )}
        </Card>
      )}
      {stale && (
        <>
          <Body>Review the refreshed information before saving retained input again.</Body>
          <Action
            title="I reviewed the refreshed information"
            onPress={() => {
              setSkillRevision(data.skills.find((s) => s.id === editingSkill)?.revision ?? 0);
              setBindingRevision(data.bindings.find((b) => b.stepId === stepId)?.revision ?? 0);
              setStale(false);
            }}
          />
        </>
      )}
      {data.steps
        .filter((step) => step.content.responsibility !== 'human')
        .map((step) => {
          const binding = data.bindings.find((b) => b.stepId === step.id),
            attempts = data.attempts.filter((a) => a.stepId === step.id),
            results = data.results.filter((r) => r.stepId === step.id),
            blocked = step.content.dependencies.some((id) => {
              const d = data.steps.find((s) => s.id === id);
              return d?.status !== 'completed' && !(d?.status === 'skipped' && !d.content.required);
            });
          return (
            <Card key={step.id}>
              <Heading compact>{step.content.title}</Heading>
              <Body>
                {step.content.responsibility === 'human'
                  ? 'Human'
                  : step.content.responsibility === 'agent'
                    ? 'Agent'
                    : 'Human or agent'}{' '}
                ·{' '}
                {step.status === 'completed'
                  ? 'Completed'
                  : attempts.at(-1) &&
                      !['failed', 'expired', 'reconciled'].includes(
                        attempts.at(-1)!.effectiveStatus,
                      )
                    ? (names[attempts.at(-1)!.effectiveStatus] ?? attempts.at(-1)!.effectiveStatus)
                    : blocked
                      ? 'Waiting for prerequisites'
                      : step.content.responsibility === 'human'
                        ? 'Needs you'
                        : binding
                          ? 'Procedure ready'
                          : 'Needs a procedure'}
              </Body>
              {['running', 'cancel-requested'].includes(attempts.at(-1)?.effectiveStatus ?? '') &&
                attempts.at(-1)?.progress.at(-1) && (
                  <Body>{attempts.at(-1)!.progress.at(-1)!.message}</Body>
                )}
              {attempts.map((a, index) => (
                <Card key={a.id}>
                  <Disclosure
                    title={`Run ${index + 1} details · ${names[a.effectiveStatus] ?? a.effectiveStatus}`}
                  >
                    <Body>
                      Started {stamp(a.createdAt)}; updated {stamp(a.updatedAt)}; connection lease
                      until {stamp(a.expiresAt)}
                    </Body>
                    <Body>Worker: {a.actorId}</Body>
                    <Body>
                      Procedure: {a.snapshot.skill.name}, version {a.snapshot.binding.skillVersion}
                    </Body>
                    <Body>{a.snapshot.skill.instructions}</Body>
                    {Object.entries(a.snapshot.binding.inputs).map(([key, value]) => (
                      <Body key={key}>
                        {key}: {value}
                      </Body>
                    ))}
                    <Body>
                      Expected at execution:{' '}
                      {a.snapshot.binding.requirements
                        .map((r) => `${r.key} (${r.kind})`)
                        .join(', ')}
                    </Body>
                    {a.snapshot.skill.resources.map((url) => (
                      <Action
                        key={url}
                        title={`Resource used: ${url}`}
                        secondary
                        onPress={() =>
                          void Linking.openURL(url).catch((e) => setNotice(messageOf(e)))
                        }
                      />
                    ))}
                    {a.progress.map((p, i) => (
                      <Body key={i}>
                        {stamp(p.at)} · {p.message}
                      </Body>
                    ))}
                    {a.error && <Body error>{a.error}</Body>}
                    {a.reconciliation?.outcome === 'performed' &&
                      !a.reconciliation.replacementAuthorized && (
                        <Body>
                          Existing external effect preserved. A replacement requires explicit
                          permission.
                        </Body>
                      )}
                    {a.reconciliation && (
                      <Body>
                        Verified{' '}
                        {a.reconciliation.outcome === 'performed' ? 'performed' : 'not performed'}:{' '}
                        {a.reconciliation.evidence}
                      </Body>
                    )}
                  </Disclosure>
                  {['running', 'cancel-requested'].includes(a.effectiveStatus) && (
                    <Disclosure title="Stop this run">
                      <Field
                        label={`Reason for stopping attempt ${index + 1}`}
                        value={feedback[a.id] ?? ''}
                        onChangeText={(v) => setFeedback({ ...feedback, [a.id]: v })}
                      />
                      <Action
                        title={`Request stop for attempt ${index + 1}`}
                        variant="secondary"
                        disabled={
                          locked ||
                          !feedback[a.id]?.trim() ||
                          a.effectiveStatus === 'cancel-requested'
                        }
                        onPress={() =>
                          command({
                            type: 'attempt.cancel',
                            taskId,
                            stepId: step.id,
                            attemptId: a.id,
                            reason: feedback[a.id],
                          })
                        }
                      />
                      <Body>
                        Stopping is cooperative. Wait for confirmation or verify the destination.
                      </Body>
                    </Disclosure>
                  )}
                  {a.effectiveStatus === 'outcome-unknown' && (
                    <>
                      <Body error>
                        The connection ended without a confirmed outcome. A timeout does not prove
                        an upload stopped. Inspect the destination before retrying.
                      </Body>
                      <Choice
                        label="Verified outcome"
                        value={outcomes[a.id] ?? ''}
                        options={[
                          { value: 'performed', label: 'The action occurred' },
                          { value: 'not-performed', label: 'The action did not occur' },
                        ]}
                        onChange={(v) =>
                          setOutcomes({ ...outcomes, [a.id]: v as 'performed' | 'not-performed' })
                        }
                      />
                      <Field
                        label="Evidence from your check"
                        multiline
                        value={evidence[a.id] ?? ''}
                        onChangeText={(v) => setEvidence({ ...evidence, [a.id]: v })}
                      />
                      {outcomes[a.id] === 'performed' &&
                        a.snapshot.binding.requirements.map((r) => (
                          <Field
                            key={r.key}
                            label={`Verified ${r.key} ${r.kind === 'file' ? 'private file version ID' : r.kind === 'link' ? 'receipt link' : 'result text'}`}
                            multiline
                            autoCapitalize="none"
                            value={receipt[`${a.id}:${r.key}`] ?? ''}
                            onChangeText={(v) =>
                              setReceipt({ ...receipt, [`${a.id}:${r.key}`]: v })
                            }
                          />
                        ))}
                      <Field
                        label="Evidence that the previous worker stopped"
                        multiline
                        value={stopped[a.id] ?? ''}
                        onChangeText={(v) => setStopped({ ...stopped, [a.id]: v })}
                      />
                      <Choice
                        label="Authorize a replacement attempt after verified worker stop"
                        value={replacement[a.id] ?? 'no'}
                        options={[
                          { value: 'no', label: 'Preserve existing effect' },
                          { value: 'yes', label: 'Authorize replacement' },
                        ]}
                        onChange={(v) => setReplacement({ ...replacement, [a.id]: v })}
                      />
                      <Action
                        title="Save verified outcome"
                        disabled={
                          locked ||
                          !outcomes[a.id] ||
                          !evidence[a.id]?.trim() ||
                          (a.snapshot.binding.risk === 'external-effect' &&
                            (outcomes[a.id] === 'not-performed' || replacement[a.id] === 'yes') &&
                            !stopped[a.id]?.trim())
                        }
                        onPress={() =>
                          command({
                            type: 'attempt.reconcile',
                            taskId,
                            stepId: step.id,
                            attemptId: a.id,
                            outcome: outcomes[a.id],
                            evidence: evidence[a.id],
                            workerStoppedEvidence: stopped[a.id] || undefined,
                            allowReplacement: replacement[a.id] === 'yes',
                            artifacts:
                              outcomes[a.id] === 'performed'
                                ? a.snapshot.binding.requirements
                                    .filter(
                                      (r) => r.required || receipt[`${a.id}:${r.key}`]?.trim(),
                                    )
                                    .map((r) => ({
                                      key: r.key,
                                      kind: r.kind,
                                      ...(r.kind === 'text'
                                        ? { text: receipt[`${a.id}:${r.key}`] }
                                        : r.kind === 'link'
                                          ? {
                                              url: receipt[`${a.id}:${r.key}`],
                                              description: evidence[a.id],
                                            }
                                          : {
                                              fileId: receipt[`${a.id}:${r.key}`],
                                              description: evidence[a.id],
                                            }),
                                    }))
                                : [],
                          })
                        }
                      />
                    </>
                  )}
                  {['failed', 'expired', 'yielded', 'reconciled'].includes(a.effectiveStatus) && (
                    <Body>
                      {binding?.retryable
                        ? 'A connected worker can retry eligible work. Previous attempts remain here.'
                        : 'Automatic retry is disabled.'}
                    </Body>
                  )}
                </Card>
              ))}
              {results.map((result) => (
                <Disclosure
                  key={result.id}
                  title={`Result version ${result.version}${result.approvedAt ? ' · Approved' : ''}`}
                  defaultOpen={result === results.at(-1)}
                >
                  <Body>{result.summary}</Body>
                  <Disclosure title="Result details">
                    <Body>
                      Submitted {stamp(result.createdAt)} · Run{' '}
                      {attempts.findIndex((a) => a.id === result.attemptId) + 1}
                    </Body>
                    <Body>
                      Approval applies to this version only. Upload and publication are separate
                      actions.
                    </Body>
                  </Disclosure>
                  {result.artifacts.map((a) => (
                    <View key={a.key}>
                      <Body>{a.key}</Body>
                      {a.kind === 'text' ? (
                        <Body>{a.text}</Body>
                      ) : a.kind === 'link' ? (
                        <Action
                          title={a.description || 'Open result'}
                          secondary
                          onPress={() =>
                            void Linking.openURL(a.url).catch((e) => setNotice(messageOf(e)))
                          }
                        />
                      ) : (
                        <>
                          <Disclosure title="File version details">
                            <Body>Immutable private file: {a.fileId}</Body>
                          </Disclosure>
                          <Action
                            title={a.description || 'Open private file'}
                            secondary
                            onPress={() => void openFile(a.fileId)}
                          />
                        </>
                      )}
                    </View>
                  ))}
                  {result.feedback && <Body>Revision requested: {result.feedback}</Body>}
                  {result === results.at(-1) && !result.approvedAt && (
                    <>
                      <Body>Approve this version to continue.</Body>
                      <Action
                        title={`Approve version ${result.version}`}
                        disabled={locked || !!result.approvedAt || result !== results.at(-1)}
                        onPress={() =>
                          command({
                            type: 'result.approve',
                            taskId,
                            stepId: step.id,
                            resultId: result.id,
                            expectedVersion: result.version,
                          })
                        }
                      />
                      <Field
                        label={`Changes for version ${result.version}`}
                        multiline
                        value={feedback[result.id] ?? ''}
                        onChangeText={(v) => setFeedback({ ...feedback, [result.id]: v })}
                      />
                      <Action
                        title={`Request changes to version ${result.version}`}
                        secondary
                        disabled={
                          locked || !feedback[result.id]?.trim() || result !== results.at(-1)
                        }
                        onPress={() =>
                          command({
                            type: 'result.request-changes',
                            taskId,
                            stepId: step.id,
                            resultId: result.id,
                            expectedVersion: result.version,
                            feedback: feedback[result.id],
                          })
                        }
                      />
                    </>
                  )}
                </Disclosure>
              ))}
            </Card>
          );
        })}
      <Disclosure
        title="Configure agent step"
        open={configurationOpen}
        onOpenChange={setConfigurationOpen}
      >
        <Body>Choose a step and the instructions its agent should follow.</Body>
        {data.steps
          .filter((step) => step.content.responsibility !== 'human')
          .map((step) => (
            <Action
              key={step.id}
              title={`Set procedure for ${step.content.title}`}
              secondary
              disabled={locked}
              onPress={() => selectStep(step)}
            />
          ))}
        {stepId && (
          <Card>
            <Heading>
              Procedure for {data.steps.find((s) => s.id === stepId)?.content.title}
            </Heading>
            <Choice
              label="Reusable procedure"
              value={skillId}
              options={data.skills.map((s) => ({ value: s.id, label: s.versions.at(-1)!.name }))}
              disabled={locked}
              onChange={(v) => {
                setSkillId(v);
                setVersion('1');
                setInputs({});
              }}
            />
            {skill && (
              <Choice
                label="Procedure version"
                value={version}
                options={skill.versions.map((v, i) => ({
                  value: String(i + 1),
                  label: `${i + 1} · ${v.name}`,
                }))}
                onChange={setVersion}
                disabled={locked}
              />
            )}
            {content && (
              <>
                <Body>{content.instructions}</Body>
                {content.inputKeys.map((key) => (
                  <Field
                    key={key}
                    label={key}
                    multiline
                    editable={!locked}
                    value={inputs[key] ?? ''}
                    onChangeText={(v) => setInputs({ ...inputs, [key]: v })}
                  />
                ))}
                <Body>
                  Expected deliverable:{' '}
                  {content.requirements
                    .map((r) => `${r.key} (${r.kind})${r.required ? ' required' : ''}`)
                    .join('; ')}
                </Body>
              </>
            )}
            <Choice
              label="External destination action"
              value={risk}
              options={[
                { value: 'none', label: 'No external action' },
                { value: 'external-effect', label: 'Yes, such as uploading' },
              ]}
              onChange={setRisk}
              disabled={locked}
            />
            <Choice
              label="Allow retry after confirmed failure"
              value={retryable}
              options={[
                { value: 'yes', label: 'Allow retry' },
                { value: 'no', label: 'No retry' },
              ]}
              onChange={setRetryable}
              disabled={locked}
            />
            <Choice
              label="Require exact result approval"
              value={approval}
              options={[
                { value: 'yes', label: 'Require approval' },
                { value: 'no', label: 'Continue without approval' },
              ]}
              onChange={setApproval}
              disabled={locked}
            />
            <Action
              title="Save procedure binding"
              disabled={locked || !content || !!content?.inputKeys.some((k) => !inputs[k]?.trim())}
              onPress={() => {
                if (!content) return;
                command({
                  type: 'binding.put',
                  taskId,
                  stepId,
                  expectedRevision: bindingRevision,
                  skillId,
                  skillVersion: Number(version),
                  inputs: Object.fromEntries(content.inputKeys.map((k) => [k, inputs[k] ?? ''])),
                  requirements: content.requirements,
                  risk,
                  retryable: retryable === 'yes',
                  requiresApproval: approval === 'yes',
                });
              }}
            />
            <Action title="Close procedure" secondary onPress={() => setStepId('')} />
          </Card>
        )}
        <Action
          title="New reusable procedure"
          secondary
          disabled={locked}
          onPress={() => editSkill('')}
        />
        {data.skills.map((s) => (
          <Action
            key={s.id}
            title={`Edit ${s.versions.at(-1)!.name}`}
            secondary
            disabled={locked}
            onPress={() => editSkill(s.id)}
          />
        ))}
        {editor && (
          <Card>
            <Heading>Reusable procedure</Heading>
            <Body>
              Bounded instructions and resources guide a worker. They grant no account permissions
              and run no code here. Saving creates a new version.
            </Body>
            <Field
              label="Procedure name"
              value={name}
              maxLength={200}
              editable={!locked}
              onChangeText={setName}
            />
            <Field
              label="Bounded instructions"
              value={instructions}
              multiline
              maxLength={20000}
              editable={!locked}
              onChangeText={setInstructions}
            />
            <Field
              label="Resource links (one per line)"
              value={resources}
              multiline
              autoCapitalize="none"
              editable={!locked}
              onChangeText={setResources}
            />
            <Field
              label="Required input names (comma separated)"
              value={inputNames}
              editable={!locked}
              onChangeText={setInputNames}
            />
            <Field
              label="Deliverable name"
              value={deliverable}
              editable={!locked}
              onChangeText={setDeliverable}
            />
            <Choice
              label="Deliverable type"
              value={kind}
              options={[
                { value: 'text', label: 'Text' },
                { value: 'link', label: 'Link' },
                { value: 'file', label: 'Private file' },
              ]}
              onChange={setKind}
              disabled={locked}
            />
            <Action
              title="Save new procedure version"
              disabled={locked || !name.trim() || !instructions.trim()}
              onPress={() => {
                try {
                  const content = SkillContentSchema.parse({
                    name,
                    instructions,
                    resources: resources
                      .split('\n')
                      .map((v) => v.trim())
                      .filter(Boolean),
                    inputKeys: inputNames
                      .split(',')
                      .map((v) => v.trim())
                      .filter(Boolean),
                    requirements: [
                      { key: deliverable, kind, required: true },
                      ...(data.skills
                        .find((s) => s.id === editingSkill)
                        ?.versions.at(-1)
                        ?.requirements.slice(1) ?? []),
                    ],
                  });
                  command({
                    type: 'skill.put',
                    id: editingSkill || Crypto.randomUUID(),
                    expectedRevision: skillRevision,
                    content,
                  });
                } catch (e) {
                  setNotice(messageOf(e));
                }
              }}
            />
            <Action title="Close reusable procedure" secondary onPress={() => setEditor(false)} />
          </Card>
        )}
        <Disclosure title="Advanced">
          <Disclosure title="Use workflow template">
            <Body>YouTube example · eight editable steps, created in Planned.</Body>
            <Action
              title="Create a fictional YouTube workflow in Planned"
              secondary
              disabled={locked}
              onPress={() =>
                command({ type: 'workflow.youtube-create', taskId: Crypto.randomUUID() })
              }
            />
          </Disclosure>
        </Disclosure>
      </Disclosure>
      <Disclosure title="Private task files">
        <Body>
          Choose a private script, image, PDF document or MP4 preview up to 50 MB, or create a text
          version.
        </Body>
        <Action
          title="Choose a private file"
          secondary
          disabled={locked}
          onPress={() => void pickFile()}
        />
        {document && (
          <>
            <Body>Selected: {document.name}</Body>
            <Action
              title="Use typed text instead"
              secondary
              disabled={locked}
              onPress={() => setDocument(null)}
            />
          </>
        )}
        <Field
          label="Private text filename"
          value={fileName}
          editable={!locked}
          onChangeText={setFileName}
        />
        <Field
          label="Private text contents"
          multiline
          value={fileText}
          editable={!locked}
          onChangeText={setFileText}
        />
        <Action
          title={
            uploadPlan.current?.review
              ? 'Review refreshed task and resume file transfer'
              : uploadPlan.current
                ? 'Retry the same file transfer'
                : 'Attach private file'
          }
          busy={busy}
          disabled={!!pending.current || (!fileText.trim() && !document && !uploadPlan.current)}
          onPress={() => void uploadText()}
        />
        {files
          .filter((f) => f.status === 'finalized' && !f.detachedAt)
          .map((f) => (
            <View key={f.id}>
              <Body>
                {f.name} · {f.size} bytes · Immutable version {f.id}
              </Body>
              <Action title={`Open ${f.name}`} secondary onPress={() => void openFile(f.id)} />
            </View>
          ))}
      </Disclosure>
      <Disclosure title="More">
        <Action
          title="Refresh workflow"
          secondary
          busy={busy}
          onPress={() => void load().catch((e) => setNotice(messageOf(e)))}
        />
      </Disclosure>
    </View>
  );
}
