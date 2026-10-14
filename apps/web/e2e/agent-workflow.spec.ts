import { expect, test } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
const email = process.env.WEB_TEST_EMAIL,
  password = process.env.WEB_TEST_PASSWORD;
const origin = new URL(process.env.WEB_TEST_URL ?? 'http://127.0.0.1:5173').origin;
let taskId = '';
const extraTasks = new Set<string>();
test.beforeEach(async ({ page }) => {
  test.skip(!email || !password, 'Requires disposable owner installation.');
  taskId = '';
  extraTasks.clear();
  await page.goto('/');
  await page.getByLabel('Email address').fill(email!);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true }).first()).toBeVisible();
});
test.afterEach(async ({ page }) => {
  for (const id of new Set([taskId, ...extraTasks].filter(Boolean))) {
    const current = await page.request.get(`/api/tasks/${id}`);
    if (!current.ok()) continue;
    const { task } = await current.json();
    if (task.deletedAt) continue;
    const response = await page.request.post('/api/tasks/commands', {
      headers: { Origin: origin },
      data: {
        type: 'task.delete',
        operationId: randomUUID(),
        taskId: id,
        expectedRevision: task.revision,
      },
    });
    expect(response.ok()).toBeTruthy();
  }
});
test('owner binds a revision, reviews actual output, requests another version and approves precisely', async ({
  page,
}, info) => {
  const post = async (path: string, data: object) => {
    const r = await page.request.post(path, { headers: { Origin: origin }, data });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  const suffix = randomUUID().slice(0, 8),
    title = `Fictional workflow ${suffix}`;
  taskId = randomUUID();
  const { task } = await post('/api/tasks/commands', {
    type: 'task.create',
    operationId: randomUUID(),
    taskId,
    expectedRevision: 0,
    content: { title, description: 'Fictional test only', notes: '' },
  });
  const stepId = randomUUID();
  await post('/api/steps/commands', {
    type: 'step.create',
    operationId: randomUUID(),
    taskId,
    id: stepId,
    expectedRevision: 0,
    expectedTaskRevision: task.revision,
    content: {
      title: 'Write fictional script',
      instructions: 'Write a fictional script',
      responsibility: 'agent',
      required: true,
      dependencies: [],
      order: 0,
    },
  });
  await page.goto('/#tasks');
  await page.getByRole('button', { name: title, exact: true }).click();
  const ui = page.getByRole('region', { name: 'Agent workflow' });
  await expect(ui.getByRole('heading', { name: 'Agent work & review' })).toBeVisible();
  await expect(ui.getByLabel('File to attach')).not.toBeVisible();
  await expect(
    ui.getByRole('button', { name: 'Set procedure for Write fictional script' }),
  ).not.toBeVisible();
  await expect(
    ui.getByRole('button', { name: 'Create a fictional YouTube workflow in Planned' }),
  ).not.toBeVisible();
  await ui.getByText('Private task files', { exact: true }).click();
  await ui.getByLabel('File to attach').setInputFiles({
    name: 'fictional-source.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Fictional source file, no personal records.'),
  });
  await ui.getByRole('button', { name: 'Attach private file', exact: true }).click();
  await expect(ui.getByRole('link', { name: 'fictional-source.txt', exact: true })).toBeVisible();
  const attached = await page.request.get(`/api/tasks/${taskId}/files`);
  const attachedFiles = (await attached.json()).files;
  expect(attachedFiles).toHaveLength(1);
  expect(attachedFiles[0].status).toBe('finalized');
  const bytes = await page.request.get(`/api/task-files/${attachedFiles[0].id}`);
  expect(await bytes.text()).toBe('Fictional source file, no personal records.');
  await ui.getByText('Configure agent step', { exact: true }).click();
  await ui.getByText('Reusable procedures', { exact: true }).click();
  await ui.getByLabel('Procedure name').fill(`Fictional script procedure ${suffix}`);
  await ui
    .getByLabel('Bounded instructions')
    .fill('Use the fictional brief only. Return a saved script.');
  await ui.getByLabel('Required input names (comma separated)').fill('brief');
  await ui.getByLabel('Deliverable name').fill('script');
  await ui.getByRole('button', { name: 'Save new procedure version' }).click();
  await expect(ui.getByRole('status')).toHaveText('Saved.');
  await ui.getByRole('button', { name: 'Set procedure for Write fictional script' }).click();
  await ui
    .getByLabel('Reusable procedure', { exact: true })
    .selectOption({ label: `Fictional script procedure ${suffix}` });
  await ui.getByLabel('brief', { exact: true }).fill('Explain imaginary planets.');
  await ui.getByRole('button', { name: 'Save procedure binding' }).click();
  await expect(ui.getByRole('status')).toHaveText('Saved.');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Release to Next', exact: true })
    .click();
  async function finish(text: string) {
    const read = await page.request.get(`/api/tasks/${taskId}/agent-workflow`);
    const work = await read.json(),
      step = work.steps.find((s: { id: string }) => s.id === stepId),
      ownershipToken = randomBytes(32).toString('base64url');
    const claim = await post('/api/agent-workflows/commands', {
      type: 'attempt.claim',
      operationId: randomUUID(),
      taskId,
      stepId,
      expectedStepRevision: step.revision,
      ownershipToken,
    });
    await post('/api/agent-workflows/commands', {
      type: 'attempt.finish',
      operationId: randomUUID(),
      taskId,
      stepId,
      attemptId: claim.attempt.id,
      ownershipToken,
      artifacts: [{ key: 'script', kind: 'text', text }],
      summary: 'Fictional script output',
    });
    const more = ui
      .locator('details')
      .filter({ has: page.locator('summary', { hasText: /^More$/ }) });
    if (!(await more.evaluate((el) => (el as HTMLDetailsElement).open)))
      await ui.getByText('More', { exact: true }).click();
    await ui.getByRole('button', { name: 'Refresh workflow' }).click();
  }
  await finish('The first actual fictional script.');
  await expect(ui.getByText('The first actual fictional script.', { exact: true })).toBeVisible();
  await ui.getByLabel('Changes for version 1').fill('Add a fictional moon.');
  await ui.getByRole('button', { name: 'Request changes to version 1' }).click();
  await expect(ui.getByRole('status')).toHaveText('Saved.');
  await finish('The revised fictional script with a moon.');
  await ui.getByRole('button', { name: 'Approve version 2' }).click();
  await expect(ui.getByRole('heading', { name: 'Result version 2 · Approved' })).toBeVisible();
  await expect(ui.getByRole('button', { name: 'Approve version 1' })).toHaveCount(0);
  await ui.getByRole('heading', { name: 'Result version 1', exact: true }).click();
  await expect(ui.getByText('The first actual fictional script.', { exact: true })).toBeVisible();
  const verified = await page.request.get(`/api/tasks/${taskId}/agent-workflow`);
  const saved = await verified.json();
  expect(saved.attempts).toHaveLength(2);
  expect(saved.results[0].approvedAt).toBeNull();
  expect(saved.results[1].approvedAt).not.toBeNull();
  await info.attach('workflow-receipt', {
    body: JSON.stringify(
      { taskId, attempts: saved.attempts.map((a: { id: string }) => a.id), results: saved.results },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  await page.screenshot({
    path: `../../.scratch/mems-life-v1/evidence/agent-workflow-ui/${info.project.name}-review.png`,
    fullPage: true,
  });
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: /Today/ })
    .click();
  await page.getByRole('button', { name: 'Capture a task', exact: true }).click();
  await expect(page.getByLabel('New task', { exact: true })).toBeFocused();
});

test('fictional YouTube template stays Planned and opens eight editable steps', async ({
  page,
}) => {
  taskId = randomUUID();
  const title = `Fictional example host ${randomUUID().slice(0, 8)}`;
  const response = await page.request.post('/api/tasks/commands', {
    headers: { Origin: origin },
    data: {
      type: 'task.create',
      operationId: randomUUID(),
      taskId,
      expectedRevision: 0,
      content: { title, description: 'Fictional only', notes: '' },
    },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto('/#tasks');
  await page.getByRole('button', { name: title, exact: true }).click();
  await page.getByRole('dialog').getByText('More task actions', { exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Manage agent work', exact: true })
    .click();
  const ui = page.getByRole('region', { name: 'Agent workflow' });
  await expect(
    ui.getByRole('button', { name: 'Create a fictional YouTube workflow in Planned' }),
  ).not.toBeVisible();
  await ui.getByText('Advanced', { exact: true }).click();
  await ui.getByText('Use workflow template', { exact: true }).click();
  const savedResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/agent-workflows/commands') &&
      r.request().postDataJSON()?.type === 'workflow.youtube-create',
  );
  await ui.getByRole('button', { name: 'Create a fictional YouTube workflow in Planned' }).click();
  const created = await (await savedResponse).json();
  extraTasks.add(created.task.id);
  expect(created.task.phase).toBe('planned');
  await expect(ui.getByRole('status')).toContainText(
    'Fictional YouTube workflow created in Planned.',
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: created.task.content.title, exact: true }).click();
  await expect(page.locator('.agent-workflow .workflow-steps > article')).toHaveCount(4);
  await expect(ui.getByRole('button', { name: 'Release to Next' })).toHaveCount(0);
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Release to Next', exact: true }),
  ).toBeVisible();
  const workflow = await page.request.get(`/api/tasks/${created.task.id}/agent-workflow`);
  const data = await workflow.json();
  expect(data.attempts).toHaveLength(0);
  expect(
    data.steps.some(
      (s: { content: { responsibility: string } }) => s.content.responsibility === 'human',
    ),
  ).toBeTruthy();
  expect(data.bindings.some((b: { requiresApproval: boolean }) => b.requiresApproval)).toBeTruthy();
});
