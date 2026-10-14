import { deviceTimerRemaining } from '../timers';
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-crypto', () => ({}));
jest.mock('expo-notifications', () => ({}));
jest.mock('expo-haptics', () => ({}));

test('device-clock rollback cannot expand a saved interval during countdown or pause', () => {
  const startedAt = Date.parse('2026-10-13T12:00:00Z');
  const timer = { deadline: startedAt + 90_000, remaining: 90 };
  expect(deviceTimerRemaining(timer, startedAt + 30_000)).toBe(60);
  expect(deviceTimerRemaining(timer, startedAt - 3_600_000)).toBe(90);
  const paused = { deadline: null, remaining: deviceTimerRemaining(timer, startedAt - 3_600_000) };
  expect(deviceTimerRemaining(paused, startedAt)).toBe(90);
  expect(deviceTimerRemaining(timer, startedAt + 100_000)).toBe(0);
});
