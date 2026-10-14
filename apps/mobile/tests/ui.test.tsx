import React from 'react';
import { useWindowDimensions } from 'react-native';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  default: jest.fn(() => ({ width: 390, height: 844, scale: 3, fontScale: 1 })),
}));
import { render, fireEvent, screen } from '@testing-library/react-native';
import { Action, Body, Choice, Disclosure, Field } from '../src/ui';

test('unit selection reports the actual chosen unit and remains accessible', async () => {
  const choose = jest.fn();
  await render(
    <Choice
      label="Weight"
      value="kg"
      options={[
        { value: 'kg', label: 'Kilograms' },
        { value: 'lb', label: 'Pounds' },
      ]}
      onChange={choose}
    />,
  );
  await fireEvent.press(screen.getByRole('radio', { name: 'Pounds' }));
  expect(choose).toHaveBeenCalledWith('lb');
  expect(screen.getByRole('radio', { name: 'Kilograms' }).props.accessibilityState.checked).toBe(
    true,
  );
});
test('profile field keeps its accessible label and entered value', async () => {
  const change = jest.fn();
  await render(<Field label="Display name" value="Morgan" onChangeText={change} />);
  await fireEvent.changeText(screen.getByLabelText('Display name'), 'Taylor');
  expect(change).toHaveBeenCalledWith('Taylor');
  expect(screen.getByLabelText('Display name').props.value).toBe('Morgan');
});

test('Dynamic Type refreshes native text and input without losing disclosure, draft or pending state', async () => {
  let mounts = 0;
  const save = jest.fn();
  function Editor() {
    const [draft, setDraft] = React.useState('');
    const [pending, setPending] = React.useState(false);
    React.useEffect(() => {
      mounts++;
    }, []);
    return (
      <Disclosure title="Editor options">
        <Body>{pending ? 'Save is unconfirmed' : 'Ready to save'}</Body>
        <Field label="Retained notes" value={draft} onChangeText={setDraft} editable={!pending} />
        <Action
          title="Save draft"
          disabled={pending}
          onPress={() => {
            save(draft);
            setPending(true);
          }}
        />
      </Disclosure>
    );
  }
  const view = await render(<Editor />);
  await fireEvent.press(screen.getByRole('button', { name: 'Editor options' }));
  await fireEvent.changeText(screen.getByLabelText('Retained notes'), 'Keep this unsaved note');
  await fireEvent.press(screen.getByRole('button', { name: 'Save draft' }));
  const originalInput = screen.getByLabelText('Retained notes');
  const originalText = screen.getByText('Save is unconfirmed');
  jest
    .mocked(useWindowDimensions)
    .mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 3.1 });
  await view.rerender(<Editor />);
  expect(mounts).toBe(1);
  expect(
    screen.getByRole('button', { name: 'Editor options' }).props.accessibilityState.expanded,
  ).toBe(true);
  expect(screen.getByLabelText('Retained notes').props.value).toBe('Keep this unsaved note');
  expect(screen.getByLabelText('Retained notes').props.editable).toBe(false);
  expect(screen.getByLabelText('Retained notes')).not.toBe(originalInput);
  expect(screen.getByText('Save is unconfirmed')).not.toBe(originalText);
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  expect(save).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Editor options' }));
  jest
    .mocked(useWindowDimensions)
    .mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
  await view.rerender(<Editor />);
  expect(screen.queryByLabelText('Retained notes')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Editor options' }));
  expect(screen.getByLabelText('Retained notes').props.value).toBe('Keep this unsaved note');
  expect(mounts).toBe(1);
});
