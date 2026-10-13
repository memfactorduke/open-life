import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { Choice, Field } from '../src/ui';

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
