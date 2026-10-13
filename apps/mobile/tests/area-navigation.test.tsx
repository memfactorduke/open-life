import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AreaNavigation } from '../src/App';

jest.mock('../src/client', () => ({
  createInstallationClient: jest.fn(),
  SessionExpiredError: class SessionExpiredError extends Error {},
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000001' }));
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-notifications', () => ({}));

test('large-text area selection closes the picker and reflects the new selected area', async () => {
  const selected = jest.fn();
  function Navigation() {
    const [area, setArea] = useState<'Today' | 'Tasks' | 'Workouts' | 'Food' | 'Settings'>('Today');
    return (
      <AreaNavigation
        area={area}
        onSelect={(name) => {
          selected(name);
          setArea(name);
        }}
        wide={false}
        largeText
      />
    );
  }
  await render(<Navigation />);
  await fireEvent.press(screen.getByRole('button', { name: 'Today. Change area' }));
  expect(screen.getByRole('button', { name: 'Today', selected: true })).toBeOnTheScreen();
  for (const name of ['Today', 'Tasks', 'Workouts', 'Food', 'Settings']) {
    expect(screen.getByRole('button', { name })).toBeOnTheScreen();
  }
  await fireEvent.press(screen.getByRole('button', { name: 'Workouts' }));
  expect(selected).toHaveBeenCalledWith('Workouts');
  expect(screen.queryByText('Choose area')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Workouts. Change area' }));
  expect(screen.getByRole('button', { name: 'Workouts', selected: true })).toBeOnTheScreen();
});

test('closing or using accessibility escape dismisses the picker without selecting an area', async () => {
  const selected = jest.fn();
  await render(<AreaNavigation area="Food" onSelect={selected} wide={false} largeText />);
  await fireEvent.press(screen.getByRole('button', { name: 'Food. Change area' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByText('Choose area')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Food. Change area' }));
  await fireEvent(screen.getByTestId('area-picker'), 'accessibilityEscape');
  expect(screen.queryByText('Choose area')).toBeNull();
  expect(selected).not.toHaveBeenCalled();
});

test('switching back to standard text dismisses the picker without changing the active area', async () => {
  const selected = jest.fn();
  const result = await render(
    <AreaNavigation area="Settings" onSelect={selected} wide={false} largeText />,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Settings. Change area' }));
  await result.rerender(
    <AreaNavigation area="Settings" onSelect={selected} wide={false} largeText={false} />,
  );
  expect(screen.getByRole('tab', { name: 'Settings', selected: true })).toBeOnTheScreen();
  await result.rerender(
    <AreaNavigation area="Settings" onSelect={selected} wide={false} largeText />,
  );
  expect(screen.queryByText('Choose area')).toBeNull();
  expect(selected).not.toHaveBeenCalled();
});
