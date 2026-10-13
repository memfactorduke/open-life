# 09: Use previous performance and workout history

Status: ready-for-agent
State: claimed
Blocked by: 04
Spec: [Mem's Life first release](../spec.md)
Coverage: US-40–42, US-46
Phase: authorized implementation in progress; acceptance remains unverified

## What to build

See previous comparable performance while logging and browse meaningful session/exercise progress.

## Acceptance criteria

- [ ] Display previous relevant results beside active set inputs and navigate complete, partial and corrected sessions.
- [ ] Provide exercise history and clear comparable trends without mixing incompatible measurement types.
- [ ] Define weighted working-set volume explicitly; do not report unperformed targets or missing data as actual volume.
- [ ] Preserve historical units/exercise meaning and label estimates if introduced; aggregate corrections consistently.
- [ ] Support practical pagination/filtering and accessible charts or equivalent readable values on each client.

## Verification

Log several fictional sessions in different units, correct one result and confirm previous-performance views and progress calculations update accurately.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments
