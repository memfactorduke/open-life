import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { DateTimeField } from '../src/DateTimeField';
import { DateFields, localInstant, localParts } from '../src/features/Productivity';

jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: (props: unknown) => <View testID="native-date-picker" {...(props as object)} />,
  };
});
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('better-auth/react', () => ({ createAuthClient: jest.fn() }));
jest.mock('@better-auth/expo/client', () => ({ expoClient: jest.fn() }));
jest.mock('expo-secure-store', () => ({}));
const at = '2026-10-12T18:30:00Z';

it('uses the owner IANA zone and commits an instant only after Apply', async () => {
  const change = jest.fn();
  await render(
    <DateTimeField label="Due" value={at} timezone="Pacific/Honolulu" onChange={change} />,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Choose due' }));
  const picker = screen.getByTestId('native-date-picker');
  expect(picker.props.timeZoneName).toBe('Pacific/Honolulu');
  expect(picker.props.value.toISOString()).toBe('2026-10-12T18:30:00.000Z');
  await fireEvent(picker, 'valueChange', {}, new Date('2026-10-13T00:00:00Z'));
  expect(change).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Apply due' }));
  expect(change).toHaveBeenCalledWith('2026-10-13T00:00:00Z');
});

it('Cancel preserves the existing draft and reopening discards uncommitted picker edits', async () => {
  const change = jest.fn();
  await render(
    <DateTimeField label="Due" value={at} timezone="America/New_York" onChange={change} />,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Choose due' }));
  await fireEvent(
    screen.getByTestId('native-date-picker'),
    'valueChange',
    {},
    new Date('2026-10-13T00:00:00Z'),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel due' }));
  expect(change).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Choose due' }));
  expect(screen.getByTestId('native-date-picker').props.value.toISOString()).toBe(
    '2026-10-12T18:30:00.000Z',
  );
});

it('Clear is explicit and omitted for required food timestamps', async () => {
  const change = jest.fn();
  const view = await render(
    <DateTimeField label="Due" value={at} timezone="UTC" onChange={change} />,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Choose due' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Clear due' }));
  expect(change).toHaveBeenCalledWith(null);
  await view.rerender(
    <DateTimeField label="Food" value={at} timezone="UTC" onChange={change} nullable={false} />,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Choose food' }));
  expect(screen.queryByRole('button', { name: 'Clear food' })).toBeNull();
});

it('opening an unset optional date does not turn the current time into a saved date', async () => {
  const change = jest.fn();
  await render(<DateTimeField label="Scheduled" value={null} timezone="UTC" onChange={change} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Choose scheduled' }));
  expect(Number.isFinite(screen.getByTestId('native-date-picker').props.value.getTime())).toBe(
    true,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel scheduled' }));
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByText('Scheduled: Not set · UTC')).toBeTruthy();
});

it('rejects a manual timestamp without an offset and retains the caller draft', async () => {
  const change = jest.fn();
  await render(<DateTimeField label="Due" value={at} timezone="UTC" onChange={change} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Choose due' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Enter timestamp manually' }));
  await fireEvent.changeText(screen.getByLabelText('Due timestamp'), '2026-10-12T14:30');
  await fireEvent.press(screen.getByRole('button', { name: 'Apply due' }));
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Due timestamp').props.value).toBe('2026-10-12T14:30');
  expect(screen.getByText(/Your saved value is unchanged/)).toBeTruthy();
});

it('keeps incomplete local drafts editable and preserves the documented DST policy', async () => {
  const change = jest.fn();
  await render(
    <DateFields
      label="Due"
      value={{ date: '2026-03-08', time: '' }}
      zone="America/New_York"
      onChange={change}
      disabled={false}
    />,
  );
  expect(screen.getByLabelText('Due date').props.value).toBe('2026-03-08');
  expect(change).not.toHaveBeenCalled();
  expect(localInstant('2026-03-08', '02:30', 'America/New_York')).toBe('2026-03-08T07:30:00Z');
  expect(localInstant('2026-11-01', '01:30', 'America/New_York')).toBe('2026-11-01T05:30:00Z');
  expect(localParts(at, 'Pacific/Honolulu')).toEqual({ date: '2026-10-12', time: '08:30' });
});
