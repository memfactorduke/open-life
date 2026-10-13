import React, { useContext, useState } from 'react';
import { Modal, Platform, ScrollView, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Temporal } from '@js-temporal/polyfill';
import { Action, Body, Field, Heading, usePalette } from './ui';

export function formatDateTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(value));
}

/** A picker edits a temporary instant. Only an explicit commit changes the caller's draft. */
export function DateTimeField({
  value,
  timezone,
  label,
  onChange,
  nullable = true,
  disabled = false,
}: {
  value: string | null;
  timezone: string;
  label: string;
  onChange: (value: string | null) => void;
  nullable?: boolean;
  disabled?: boolean;
}) {
  const palette = usePalette();
  const insets = useContext(SafeAreaInsetsContext) ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [manual, setManual] = useState(false);
  let formatted = 'Not set';
  try {
    if (value) formatted = formatDateTime(value, timezone);
  } catch {
    formatted = 'Review date and time';
  }
  function begin() {
    setDraft(value ?? new Date().toISOString());
    setError('');
    setManual(Platform.OS !== 'ios');
    setOpen(true);
  }
  function commit() {
    if (disabled) return;
    try {
      const instant = Temporal.Instant.from(draft).toString();
      // Validate the configured zone too; never silently substitute the device zone.
      formatDateTime(instant, timezone);
      onChange(instant);
      setOpen(false);
    } catch {
      setError(
        'Enter a valid date and time with Z or a UTC offset, such as 2026-10-12T14:30:00-04:00. Your saved value is unchanged.',
      );
    }
  }
  const validDraft = Number.isFinite(new Date(draft).getTime());
  return (
    <View style={{ gap: 8 }}>
      <Body>
        {label}: {formatted} · {timezone}
      </Body>
      <Action
        title={`Choose ${label.toLowerCase()}`}
        secondary
        disabled={disabled}
        onPress={begin}
      />
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <ScrollView
          style={{ backgroundColor: palette.background }}
          contentContainerStyle={{
            paddingTop: insets.top + 20,
            paddingBottom: insets.bottom + 24,
            paddingLeft: insets.left + 20,
            paddingRight: insets.right + 20,
            gap: 14,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <Heading>{label}</Heading>
          <Body>Times use {timezone}. Review the selected date and time before applying it.</Body>
          {!manual && validDraft ? (
            <DateTimePicker
              accessibilityLabel={`${label} picker`}
              value={new Date(draft)}
              mode="datetime"
              display="spinner"
              timeZoneName={timezone}
              themeVariant={palette.background === '#111c18' ? 'dark' : 'light'}
              onValueChange={(_event, date) => {
                if (date && Number.isFinite(date.getTime())) setDraft(date.toISOString());
              }}
            />
          ) : (
            <>
              <Body>
                Enter an exact timestamp with its UTC offset. This keeps the selected instant
                independent of the device time zone.
              </Body>
              <Field
                label={`${label} timestamp`}
                value={draft}
                onChangeText={setDraft}
                autoCapitalize="none"
                placeholder="2026-10-12T14:30:00-04:00"
              />
            </>
          )}
          {validDraft && (
            <Body>
              Selected: {formatDateTime(draft, timezone)} · {timezone}
            </Body>
          )}
          {!!error && <Body error>{error}</Body>}
          <Action title={`Apply ${label.toLowerCase()}`} disabled={disabled} onPress={commit} />
          <Action
            title="Use current time"
            secondary
            disabled={disabled}
            onPress={() => setDraft(new Date().toISOString())}
          />
          {nullable && (
            <Action
              title={`Clear ${label.toLowerCase()}`}
              secondary
              disabled={disabled}
              onPress={() => {
                onChange(null);
                setOpen(false);
              }}
            />
          )}
          {!manual && (
            <Action title="Enter timestamp manually" secondary onPress={() => setManual(true)} />
          )}
          <Action
            title={`Cancel ${label.toLowerCase()}`}
            secondary
            onPress={() => setOpen(false)}
          />
        </ScrollView>
      </Modal>
    </View>
  );
}
