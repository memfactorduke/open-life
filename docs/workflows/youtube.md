# YouTube production workflow

This is the maintainer's concrete example of an outcome that mixes human and agent work. It anchors the first task and subtask design; the application should store it as an editable workflow rather than hardcoding video-production behavior.

## Outcome and steps

The parent task is one video, from script through publication. Its default visible stages are Planned, Next, and Active; published videos remain available in completed history.

| Step | Responsible | Prerequisites | Completion evidence |
| --- | --- | --- | --- |
| Write the script | Agent | Brief and relevant source material | A saved script version. |
| Record the script | Human | Script ready | Recorded footage supplied for editing. |
| Edit the recorded video | Agent | Recording available | A saved edited-video version that can be reviewed. |
| Watch and review the edit | Human | Edited video available | Explicit acceptance of that version, or a request for changes. |
| Upload the video | Human or agent | Edited version accepted | A verified private upload and its destination identifier. |
| Make the thumbnail | Agent | Script and visual brief available | A saved thumbnail candidate. |
| Approve and upload the thumbnail | Human | Thumbnail candidate and uploaded-video destination available | The approved thumbnail version attached to the video. |
| Publish | Human | Accepted video uploaded and approved thumbnail attached | Verified publication at the intended destination. |

## Dependencies and overlap

The video path is script, recording, editing, review, then upload. Thumbnail drafting can start after the script and run alongside recording and editing. Attaching the thumbnail waits for its human approval and the uploaded-video destination. Publishing waits for both paths and remains a separate human action.

Watching a preview is not automatically acceptance. Uploading is not publishing. The upload is private until the separate publication action.

## Revision and handoff behavior

- A request for editing changes returns that same editing subtask to actionable work with the feedback and previous preview preserved. A new attempt produces a new version; it does not replace the task's history.
- Acceptance refers to a particular video or thumbnail version. A later change invalidates the relevant acceptance and dependent readiness.
- If an uploaded artifact becomes stale, reconcile the existing external upload before producing or selecting a replacement. Do not assume that the existing destination now contains the revised artifact.
- If an upload's outcome is unknown after a timeout, inspect the destination before retrying. Preserve the operation and destination identifiers so reconnecting watchers can reconcile it.
- A watcher can progress only the eligible agent steps released by the task policy. Human recording, review, thumbnail approval/attachment, and publication are visible handoffs.
- Within released work, completing a prerequisite automatically makes the next eligible agent step available. After recording is marked complete, editing can start without another Start action. Planned videos remain dormant.
- During a human handoff, the parent task remains Active and clearly states what is needed next.

## Initial verification scenario

Run the complete workflow with test artifacts and an external MCP client. Verify that two clients cannot claim the same step, a rejected edit creates another attempt, a stale result cannot satisfy a changed step, and publication remains blocked until the required human actions and artifact versions are satisfied. Production uploads and publication are outside this test unless separately requested.
