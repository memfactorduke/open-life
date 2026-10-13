import type { Pool } from 'pg';
import { z } from 'zod';
import { TaskFileAllocateSchema, TaskFileMutationSchema } from '@mems-life/domain';
import type { McpTool } from './mcp.js';
import { allocateTaskFile, finalizeTaskFile, detachTaskFile, listTaskFiles } from './task-files.js';
export function taskFileMcpTools(pool: Pool, mediaDirectory: string): McpTool[] {
  return [
    {
      name: 'task_files_list',
      scope: 'tasks:read',
      description: 'List private task-file versions and immutable identities.',
      schema: z.strictObject({ taskId: z.uuid() }),
      run: (v, a) => listTaskFiles(pool, a, v.taskId),
    },
    {
      name: 'task_file_allocate',
      scope: 'tasks:write',
      description:
        'Stage an immutable private artifact. Generate fileId and SHA256 of original bytes; PUT raw application/octet-stream bytes to returned relative uploadPath using the same Authorization Bearer credential, then finalize. Never send credentials in a URL.',
      schema: z.strictObject({ taskId: z.uuid(), upload: TaskFileAllocateSchema }),
      run: async (v, a, auth) => {
        const result = await allocateTaskFile(pool, a, v.taskId, v.upload, auth);
        return { ...result, uploadPath: `/api/task-files/${result.file.id}/content` };
      },
    },
    {
      name: 'task_file_finalize',
      scope: 'tasks:write',
      description:
        'Finalize verified uploaded bytes and attach an immutable version. Retry the same operationId and expectedRevision after a lost response.',
      schema: z.strictObject({ id: z.uuid(), command: TaskFileMutationSchema }),
      run: (v, a, auth) => finalizeTaskFile(pool, a, v.id, v.command, mediaDirectory, auth),
    },
    {
      name: 'task_file_detach',
      scope: 'tasks:write',
      description:
        'Revoke private attachment access without deleting original bytes. Human revision requests must invalidate any referenced result approval first.',
      schema: z.strictObject({ id: z.uuid(), command: TaskFileMutationSchema }),
      run: (v, a, auth) => detachTaskFile(pool, a, v.id, v.command, auth),
    },
  ];
}
