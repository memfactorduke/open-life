import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import {
  TaskSchema,
  AgentWorkflowResponseSchema,
  AgentWorkflowCommandSchema,
} from '@mems-life/domain';
import { AgentWorkflow } from '../AgentWorkflow';
import { RequestRejectedError, type InstallationClient } from '../../client';
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('better-auth/react', () => ({ createAuthClient: jest.fn() }));
jest.mock('@better-auth/expo/client', () => ({ expoClient: jest.fn() }));
let mockSeq = 100;
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async () => 'a'.repeat(64),
  randomUUID: () => `00000000-0000-4000-8000-${String(mockSeq++).padStart(12, '0')}`,
}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  at = '2026-10-12T12:00:00.000Z';
function fixture() {
  const task = TaskSchema.parse({
    id: id(1),
    revision: 1,
    phase: 'active',
    content: { title: 'Fictional film', description: '', notes: '' },
    order: 0,
    createdAt: at,
    updatedAt: at,
    completedAt: null,
    archivedAt: null,
    deletedAt: null,
  });
  const skill = {
    name: 'Write fictional script',
    instructions: 'Write only a fictional script from the brief.',
    resources: [],
    inputKeys: ['brief'],
    requirements: [{ key: 'script', kind: 'text' as const, required: true }],
  };
  const binding = {
    taskId: id(1),
    stepId: id(2),
    revision: 1,
    skillId: id(3),
    skillVersion: 1,
    inputs: { brief: 'Fictional science' },
    requirements: skill.requirements,
    risk: 'none' as const,
    retryable: true,
    requiresApproval: true,
  };
  const step = {
    id: id(2),
    taskId: id(1),
    revision: 1,
    content: {
      title: 'Draft fictional script',
      instructions: 'Fictional only',
      responsibility: 'agent' as const,
      required: true,
      dependencies: [],
      order: 0,
    },
    status: 'active' as const,
    assignedTo: null,
    deletedAt: null,
    createdAt: at,
    updatedAt: at,
  };
  return AgentWorkflowResponseSchema.parse({
    task,
    steps: [step],
    skills: [{ id: id(3), revision: 1, versions: [skill] }],
    bindings: [binding],
    attempts: [
      {
        id: id(4),
        taskId: id(1),
        stepId: id(2),
        revision: 1,
        actorId: 'fictional-worker',
        status: 'submitted',
        effectiveStatus: 'submitted',
        expiresAt: at,
        createdAt: at,
        updatedAt: at,
        snapshot: {
          stepContent: step.content,
          stepRevision: 1,
          binding,
          skill,
          dependencyRevisions: {},
        },
        progress: [{ at, message: 'Fictional script prepared' }],
        error: null,
        reconciliation: null,
      },
    ],
    results: [
      {
        revision: 1,
        id: id(5),
        taskId: id(1),
        stepId: id(2),
        attemptId: id(4),
        version: 1,
        artifacts: [{ key: 'script', kind: 'text', text: 'The actual fictional script version.' }],
        summary: 'Fictional draft',
        approvedAt: null,
        approvedBy: null,
        feedback: null,
        createdAt: at,
      },
    ],
  });
}
function client(mode = 'ok') {
  const data = fixture(),
    commands: unknown[] = [];
  let n = 0;
  const request = jest.fn(async (_path: string, body?: unknown) => {
    if (!body) return data;
    const parsed = AgentWorkflowCommandSchema.parse(body);
    commands.push(parsed);
    if (mode === 'uncertain' && n++ === 0) throw new Error('Lost response');
    if (mode === 'conflict') throw new RequestRejectedError(409, 'This version changed.');
    return { operationId: parsed.operationId, feedPosition: '1' };
  });
  return { client: { request } as unknown as InstallationClient, commands, data };
}
test('reviews actual version and retries an uncertain approval with identical operation and payload', async () => {
  const f = client('uncertain');
  await render(<AgentWorkflow client={f.client} taskId={id(1)} />);
  await screen.findByText('The actual fictional script version.');
  await fireEvent.press(screen.getByRole('button', { name: 'Approve version 1' }));
  await screen.findByText(/Lost response/);
  await fireEvent.press(screen.getByRole('button', { name: 'Retry the same change' }));
  await waitFor(() => expect(f.commands).toHaveLength(2));
  expect(f.commands[1]).toEqual(f.commands[0]);
  expect(f.commands[0]).toMatchObject({
    type: 'result.approve',
    resultId: id(5),
    expectedVersion: 1,
  });
});
test('retains review feedback across conflict and requires review before a fresh submission', async () => {
  const f = client('conflict');
  await render(<AgentWorkflow client={f.client} taskId={id(1)} />);
  await screen.findByText('The actual fictional script version.');
  await fireEvent.changeText(screen.getByLabelText('Changes for version 1'), 'Keep this feedback');
  await fireEvent.press(screen.getByRole('button', { name: 'Request changes to version 1' }));
  await screen.findByText(/This version changed/);
  expect(screen.getByLabelText('Changes for version 1').props.value).toBe('Keep this feedback');
  expect(
    screen.getByRole('button', { name: 'Request changes to version 1' }).props.accessibilityState
      .disabled,
  ).toBe(true);
  await fireEvent.press(
    screen.getByRole('button', { name: 'I reviewed the refreshed information' }),
  );
  expect(
    screen.getByRole('button', { name: 'Request changes to version 1' }).props.accessibilityState
      .disabled,
  ).toBe(false);
});
test('unknown external effect requires checked outcome and evidence and never silently retries', async () => {
  const f = client();
  f.data.attempts[0]!.status = 'outcome-unknown';
  f.data.attempts[0]!.effectiveStatus = 'outcome-unknown';
  f.data.attempts[0]!.snapshot.binding.risk = 'external-effect';
  await render(<AgentWorkflow client={f.client} taskId={id(1)} />);
  await screen.findByText(/A timeout does not prove an upload stopped/);
  expect(
    screen.getByRole('button', { name: 'Save verified outcome' }).props.accessibilityState.disabled,
  ).toBe(true);
  await fireEvent.press(screen.getByRole('radio', { name: 'The action did not occur' }));
  await fireEvent.changeText(
    screen.getByLabelText('Evidence from your check'),
    'Checked fictional destination receipt list; no upload with this operation exists.',
  );
  expect(
    screen.getByRole('button', { name: 'Save verified outcome' }).props.accessibilityState.disabled,
  ).toBe(true);
  await fireEvent.changeText(
    screen.getByLabelText('Evidence that the previous worker stopped'),
    'Worker confirmed terminal stop; receipt checked separately.',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Save verified outcome' }));
  await waitFor(() => expect(f.commands).toHaveLength(1));
  expect(f.commands[0]).toMatchObject({
    type: 'attempt.reconcile',
    outcome: 'not-performed',
    workerStoppedEvidence: 'Worker confirmed terminal stop; receipt checked separately.',
    artifacts: [],
  });
});
test('binds a chosen reusable version and required inputs with an explicit approval gate', async () => {
  const f = client();
  f.data.skills[0]!.versions.push({
    ...f.data.skills[0]!.versions[0]!,
    name: 'Revised fictional script',
    instructions: 'The revised bounded instructions',
  });
  f.data.skills[0]!.revision = 2;
  await render(<AgentWorkflow client={f.client} taskId={id(1)} />);
  await screen.findByText('The actual fictional script version.');
  await fireEvent.press(screen.getByRole('button', { name: 'Configure agent step' }));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Set procedure for Draft fictional script' }),
  );
  await fireEvent.press(screen.getByRole('radio', { name: '2 · Revised fictional script' }));
  await fireEvent.changeText(screen.getByLabelText('brief'), 'A new fictional brief');
  await fireEvent.press(screen.getByRole('button', { name: 'Save procedure binding' }));
  await waitFor(() => expect(f.commands).toHaveLength(1));
  expect(f.commands[0]).toMatchObject({
    type: 'binding.put',
    skillId: id(3),
    skillVersion: 2,
    inputs: { brief: 'A new fictional brief' },
    requiresApproval: true,
    risk: 'none',
  });
});
test('a lost file-finalization reply retries identical version and operation without repeating transfer', async () => {
  const data = fixture(),
    finalizations: unknown[] = [],
    allocations: unknown[] = [];
  let file: Record<string, unknown> | null = null;
  const request = jest.fn(async (path: string, body?: unknown) => {
    if (path.endsWith('/agent-workflow')) return data;
    if (path.endsWith('/files') && !body) return { files: file ? [file] : [] };
    if (path.endsWith('/files')) {
      allocations.push(body);
      const b = body as {
        fileId: string;
        name: string;
        size: number;
        sha256: string;
        contentType: string;
      };
      file = {
        id: b.fileId,
        taskId: id(1),
        name: b.name,
        size: b.size,
        sha256: b.sha256,
        contentType: b.contentType,
        status: 'pending',
        createdAt: at,
        detachedAt: null,
      };
      return { file };
    }
    if (path.endsWith('/finalize')) {
      finalizations.push(body);
      if (finalizations.length === 1) throw new Error('Finalization reply lost');
      file = { ...file, status: 'finalized' };
      return { file, task: data.task };
    }
    throw new Error('Unexpected request');
  });
  const oldFetch = global.fetch,
    transfer = jest.fn(async () => ({ ok: true }) as Response);
  global.fetch = transfer as typeof fetch;
  try {
    const client = {
      request,
      baseURL: 'https://fictional.example',
      auth: { getCookie: async () => '' },
    } as unknown as InstallationClient;
    await render(<AgentWorkflow client={client} taskId={id(1)} />);
    await screen.findByText('The actual fictional script version.');
    await fireEvent.press(screen.getByRole('button', { name: 'Private task files' }));
    await fireEvent.changeText(
      screen.getByLabelText('Private text filename'),
      'fictional-script.txt',
    );
    await fireEvent.changeText(
      screen.getByLabelText('Private text contents'),
      'Fictional script text',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Attach private file' }));
    await screen.findByText(/Finalization reply lost/);
    await fireEvent.press(screen.getByRole('button', { name: 'Retry the same file transfer' }));
    await screen.findByText('Private file version attached.');
    expect(allocations).toHaveLength(1);
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(finalizations).toHaveLength(2);
    expect(finalizations[1]).toEqual(finalizations[0]);
  } finally {
    global.fetch = oldFetch;
  }
});

test('keeps setup and provenance out of the review path and reveals them explicitly', async () => {
  const f = client();
  await render(<AgentWorkflow client={f.client} taskId={id(1)} />);
  await screen.findByText('The actual fictional script version.');
  expect(screen.queryByText('Worker: fictional-worker')).toBeNull();
  expect(screen.queryByText('Fictional script prepared')).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Create a fictional YouTube workflow in Planned' }),
  ).toBeNull();
  expect(screen.queryByRole('button', { name: 'New reusable procedure' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Release to Next' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Run 1 details · Needs your review' }));
  expect(screen.getByText('Worker: fictional-worker')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Configure agent step' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Advanced' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Use workflow template' }));
  expect(
    screen.getByRole('button', { name: 'Create a fictional YouTube workflow in Planned' }),
  ).toBeTruthy();
});

test('shows only latest approval controls and keeps old result content in history', async () => {
  const f = client();
  f.data.results.push({
    ...f.data.results[0]!,
    id: id(6),
    version: 2,
    artifacts: [{ key: 'script', kind: 'text', text: 'New version to review.' }],
  });
  await render(<AgentWorkflow client={f.client} taskId={id(1)} />);
  await screen.findByText('New version to review.');
  expect(screen.queryByRole('button', { name: 'Approve version 1' })).toBeNull();
  expect(screen.queryByText('The actual fictional script version.')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Result version 1' }));
  expect(screen.getByText('The actual fictional script version.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Approve version 1' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Approve version 2' }));
  await waitFor(() => expect(f.commands).toHaveLength(1));
  expect(f.commands[0]).toMatchObject({
    type: 'result.approve',
    resultId: id(6),
    expectedVersion: 2,
  });
});

test('stopping a running agent requires a reason and requests a cooperative stop', async () => {
  const f = client();
  f.data.attempts[0]!.status = 'running';
  f.data.attempts[0]!.effectiveStatus = 'running';
  f.data.results = [];
  await render(<AgentWorkflow client={f.client} taskId={id(1)} />);
  await screen.findByText('Fictional script prepared');
  expect(screen.queryByLabelText('Reason for stopping attempt 1')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Stop this run' }));
  expect(
    screen.getByRole('button', { name: 'Request stop for attempt 1' }).props.accessibilityState
      .disabled,
  ).toBe(true);
  await fireEvent.changeText(
    screen.getByLabelText('Reason for stopping attempt 1'),
    'The brief changed.',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Request stop for attempt 1' }));
  await waitFor(() => expect(f.commands).toHaveLength(1));
  expect(f.commands[0]).toMatchObject({
    type: 'attempt.cancel',
    attemptId: id(4),
    reason: 'The brief changed.',
  });
  expect(
    screen.getByText('Stopping is cooperative. Wait for confirmation or verify the destination.'),
  ).toBeTruthy();
});

test('parent configuration changes preserve drafts and an uncertain save on the mounted workflow', async () => {
  const f = client('uncertain');
  const view = await render(<AgentWorkflow client={f.client} taskId={id(1)} />);
  await screen.findByText('The actual fictional script version.');
  await fireEvent.changeText(
    screen.getByLabelText('Changes for version 1'),
    'Keep this draft across setup changes',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Approve version 1' }));
  await screen.findByText(/Lost response/);
  await view.rerender(
    <AgentWorkflow client={f.client} taskId={id(1)} configurationInitiallyOpen />,
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Configure agent step' }).props.accessibilityState
        .expanded,
    ).toBe(true),
  );
  expect(screen.getByLabelText('Changes for version 1').props.value).toBe(
    'Keep this draft across setup changes',
  );
  await view.rerender(
    <AgentWorkflow client={f.client} taskId={id(1)} configurationInitiallyOpen={false} />,
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Configure agent step' }).props.accessibilityState
        .expanded,
    ).toBe(false),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Configure agent step' }));
  expect(
    screen.getByRole('button', { name: 'Configure agent step' }).props.accessibilityState.expanded,
  ).toBe(true);
  await fireEvent.press(screen.getByRole('button', { name: 'Retry the same change' }));
  await waitFor(() => expect(f.commands).toHaveLength(2));
  expect(f.commands[1]).toEqual(f.commands[0]);
});
