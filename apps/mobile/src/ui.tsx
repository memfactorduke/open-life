import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
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
  background: '#f5f6f5',
  surface: '#ffffff',
  text: '#1c2521',
  muted: '#5f6963',
  line: '#dde2de',
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

export function Heading({
  children,
  eyebrow,
  compact = false,
}: {
  children: React.ReactNode;
  eyebrow?: string;
  compact?: boolean;
}) {
  const palette = usePalette();
  return (
    <View style={styles.heading}>
      {eyebrow && <Text style={[styles.eyebrow, { color: palette.muted }]}>{eyebrow}</Text>}
      <Text
        accessibilityRole="header"
        style={[styles.title, compact && styles.sectionTitle, { color: palette.text }]}
      >
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
  variant,
  compact = false,
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  secondary?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'quiet' | 'destructive';
  compact?: boolean;
}) {
  const palette = usePalette();
  const appearance = variant ?? (secondary ? 'secondary' : 'primary');
  const prominent = appearance === 'primary';
  const quiet = appearance === 'quiet';
  const foreground = prominent
    ? palette.accentText
    : appearance === 'destructive'
      ? palette.error
      : palette.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: busy || disabled, busy }}
      disabled={busy || disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        compact && styles.compactAction,
        {
          backgroundColor: prominent ? palette.accent : quiet ? 'transparent' : palette.surface,
          borderColor: quiet ? 'transparent' : prominent ? palette.accent : palette.line,
          opacity: pressed || disabled ? 0.6 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <Text style={[styles.actionText, { color: foreground }]}>{title}</Text>
      )}
    </Pressable>
  );
}
export function Field({
  label,
  error,
  ...props
}: TextInputProps & { label: string; error?: string }) {
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
          {
            color: palette.text,
            backgroundColor: palette.surface,
            borderColor: error ? palette.error : palette.line,
          },
          props.style,
        ]}
      />
      {!!error && <Body error>{error}</Body>}
    </View>
  );
}
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  showLabel = true,
}: {
  disabled?: boolean;
  showLabel?: boolean;
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const palette = usePalette();
  const { fontScale } = useWindowDimensions();
  const segmented = options.length <= 3 && fontScale < 1.5;
  return (
    <View style={styles.field}>
      {showLabel && <Text style={[styles.label, { color: palette.text }]}>{label}</Text>}
      <View
        style={[
          styles.choices,
          segmented && [
            styles.segmented,
            { backgroundColor: palette.background, borderColor: palette.line },
          ],
        ]}
      >
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
              segmented && styles.segment,
              {
                backgroundColor:
                  value === option.value
                    ? palette.surface
                    : segmented
                      ? 'transparent'
                      : palette.background,
                borderColor: segmented
                  ? 'transparent'
                  : value === option.value
                    ? palette.accent
                    : palette.line,
              },
            ]}
          >
            <Text
              style={[
                styles.choiceText,
                {
                  color: value === option.value ? palette.accent : palette.muted,
                  fontWeight: value === option.value ? '600' : '400',
                },
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

/** Secondary controls remain mounted after first opening so drafts survive closing. */
export function Disclosure({
  title,
  children,
  defaultOpen = false,
  disabled = false,
  open: controlledOpen,
  onOpenChange,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const palette = usePalette();
  const [localOpen, setOpen] = useState(defaultOpen);
  const open = controlledOpen ?? localOpen;
  const [visited, setVisited] = useState(open);
  useEffect(() => {
    if (open) setVisited(true);
  }, [open]);
  return (
    <View style={styles.disclosure}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={() => {
          setOpen(!open);
          onOpenChange?.(!open);
          setVisited(true);
        }}
        style={({ pressed }) => [
          styles.disclosureRow,
          { borderColor: palette.line, opacity: pressed || disabled ? 0.6 : 1 },
        ]}
      >
        <Text style={[styles.rowTitle, { color: palette.text }]}>{title}</Text>
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={{ color: palette.muted }}
        >
          {open ? '−' : '+'}
        </Text>
      </Pressable>
      {visited && (
        <View
          accessibilityElementsHidden={!open}
          importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
          style={[styles.disclosureContent, { display: open ? 'flex' : 'none' }]}
        >
          {children}
        </View>
      )}
    </View>
  );
}

export function ListRow({
  title,
  detail,
  trailing,
  onPress,
  selected = false,
  disabled = false,
}: {
  title: string;
  detail?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
  selected?: boolean;
  disabled?: boolean;
}) {
  const palette = usePalette();
  const content = (
    <>
      <View style={styles.rowContent}>
        <Text style={[styles.rowTitle, { color: palette.text }]}>{title}</Text>
        {!!detail && <Text style={[styles.rowDetail, { color: palette.muted }]}>{detail}</Text>}
      </View>
      {trailing}
      {!!onPress && (
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={{ color: palette.muted }}
        >
          ›
        </Text>
      )}
    </>
  );
  const style = [
    styles.listRow,
    { borderColor: palette.line, backgroundColor: selected ? palette.background : 'transparent' },
  ];
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [...style, { opacity: pressed || disabled ? 0.6 : 1 }]}
    >
      {content}
    </Pressable>
  ) : (
    <View style={style}>{content}</View>
  );
}
export const styles = StyleSheet.create({
  heading: { gap: 4, marginBottom: 16 },
  eyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 1.8, textTransform: 'uppercase' },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  sectionTitle: { fontSize: 19, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontSize: 15, lineHeight: 22 },
  card: { padding: 16, borderRadius: 14, borderWidth: 1, gap: 12 },
  action: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: { fontSize: 16, fontWeight: '600' },
  compactAction: { paddingVertical: 8, paddingHorizontal: 12 },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '500' },
  input: { minHeight: 44, padding: 12, fontSize: 17, borderWidth: 1, borderRadius: 10 },
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
  segmented: { flexWrap: 'nowrap', gap: 2, padding: 3, borderWidth: 1, borderRadius: 11 },
  segment: { flex: 1, flexGrow: 1, minHeight: 44, padding: 8, borderRadius: 8 },
  disclosure: { gap: 0 },
  disclosureRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  disclosureContent: { gap: 12, paddingTop: 12, paddingBottom: 8 },
  rowTitle: { fontSize: 16, lineHeight: 23, flexShrink: 1 },
  rowDetail: { fontSize: 14, lineHeight: 20, marginTop: 3 },
  rowContent: { flex: 1, minWidth: 0 },
  listRow: {
    minHeight: 52,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
