import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

export type Palette = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  line: string;
  accent: string;
  accentText: string;
  error: string;
};
export const light: Palette = {
  background: '#f5f4f0',
  surface: '#ffffff',
  text: '#182b25',
  muted: '#64756d',
  line: '#dce2dc',
  accent: '#24614c',
  accentText: '#ffffff',
  error: '#a53b32',
};
export const dark: Palette = {
  background: '#111c18',
  surface: '#1c2b24',
  text: '#edf4ee',
  muted: '#abbcb0',
  line: '#364b3e',
  accent: '#a4d7b9',
  accentText: '#14271c',
  error: '#ffb4a9',
};
export const ThemeContext = React.createContext(light);
export const usePalette = () => React.useContext(ThemeContext);

export function Heading({ children, eyebrow }: { children: React.ReactNode; eyebrow?: string }) {
  const palette = usePalette();
  return (
    <View style={styles.heading}>
      {eyebrow && <Text style={[styles.eyebrow, { color: palette.muted }]}>{eyebrow}</Text>}
      <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
        {children}
      </Text>
    </View>
  );
}
export function Body({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  const palette = usePalette();
  return (
    <Text
      accessibilityLiveRegion={error ? 'polite' : undefined}
      style={[styles.body, { color: error ? palette.error : palette.muted }]}
    >
      {children}
    </Text>
  );
}
export function Card({ children }: { children: React.ReactNode }) {
  const palette = usePalette();
  return (
    <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.line }]}>
      {children}
    </View>
  );
}
export function Action({
  title,
  onPress,
  busy,
  secondary = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  secondary?: boolean;
  disabled?: boolean;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: busy || disabled, busy }}
      disabled={busy || disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        {
          backgroundColor: secondary ? palette.surface : palette.accent,
          borderColor: secondary ? palette.line : palette.accent,
          opacity: pressed || disabled ? 0.6 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={secondary ? palette.text : palette.accentText} />
      ) : (
        <Text style={[styles.actionText, { color: secondary ? palette.text : palette.accentText }]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const palette = usePalette();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
      <TextInput
        {...props}
        testID={props.testID ?? `field-${label.toLowerCase().replace(/\s+/g, '-')}`}
        accessibilityLabel={label}
        placeholderTextColor={palette.muted}
        style={[
          styles.input,
          { color: palette.text, backgroundColor: palette.surface, borderColor: palette.line },
          props.style,
        ]}
      />
    </View>
  );
}
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  disabled?: boolean;
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const palette = usePalette();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
      <View style={styles.choices}>
        {options.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: value === option.value, disabled }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={[
              styles.choice,
              {
                backgroundColor: value === option.value ? palette.accent : palette.surface,
                borderColor: palette.line,
              },
            ]}
          >
            <Text
              style={[
                styles.choiceText,
                { color: value === option.value ? palette.accentText : palette.text },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
export const styles = StyleSheet.create({
  heading: { gap: 8, marginBottom: 24 },
  eyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 1.8, textTransform: 'uppercase' },
  title: { fontSize: 34, fontWeight: '700', letterSpacing: -1 },
  body: { fontSize: 16, lineHeight: 25 },
  card: { padding: 24, borderRadius: 20, borderWidth: 1, gap: 18 },
  action: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 13,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: { fontSize: 16, fontWeight: '600' },
  field: { gap: 8 },
  label: { fontSize: 15, fontWeight: '600' },
  input: { minHeight: 52, padding: 14, fontSize: 16, borderWidth: 1, borderRadius: 12 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    minHeight: 48,
    flexGrow: 1,
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceText: { fontSize: 15, fontWeight: '600' },
});
