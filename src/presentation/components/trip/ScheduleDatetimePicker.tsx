import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';

import { formatScheduleDateTime } from '@shared/datetime/formatScheduleDateTime';
import { LOG } from '@shared/logger';

const logger = LOG.extend('SCHEDULE_PICKER');

/**
 * Picker-side grace window over the domain floor: the picker overshoots
 * its accept-minimum by this many seconds so a value accepted at
 * picker-confirm time also survives the use case's
 * `Ride.createScheduled` floor check a few seconds later. Without the
 * grace, a rider who taps "Schedule" at exactly the 15-minute mark can
 * idle 5–15 s before submitting and trip the use-case validation.
 *
 * Kept under a minute so the user-visible "at least 15 minutes from
 * now" message stays truthful — 14:59.5 still rounds-down to 15.
 */
const SCHEDULE_PICKER_GRACE_SECONDS = 30;

/**
 * Typed port of legacy
 * `yeride/src/components/ScheduleDatetimePicker.js`. Lets the rider pick
 * a future pickup datetime with a 15-minute floor.
 *
 * Platform UX (matches legacy):
 *   - iOS: a single `display="spinner"` `mode="datetime"` picker stays
 *     visible inside the modal. Selection fires `onChange` per spin
 *     step.
 *   - Android: a two-step flow — tap the row → date picker dialog →
 *     time picker dialog → validate. `tempDate` carries the selected
 *     date across the two steps so the final value gets both halves.
 *
 * Validation: `isAfter(selectedDate, now + minimumMinutes)`. Failing
 * the floor surfaces an inline error message instead of swallowing the
 * tap — matches legacy.
 *
 * Modal flags `statusBarTranslucent` + `navigationBarTranslucent` are
 * required for Android 15 edge-to-edge (per CLAUDE.md / legacy
 * note).
 */
export interface ScheduleDatetimePickerProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onSchedule: (date: Date) => void;
  readonly initialDate?: Date;
  readonly title?: string;
  readonly buttonText?: string;
  readonly minimumMinutes?: number;
}

export function ScheduleDatetimePicker({
  visible,
  onClose,
  onSchedule,
  initialDate,
  title = 'Schedule Your Ride',
  buttonText = 'Schedule Ride',
  minimumMinutes = 15,
}: ScheduleDatetimePickerProps) {
  const [date, setDate] = useState<Date>(initialDate ?? new Date());
  const [showPicker, setShowPicker] = useState<boolean>(false);
  const [mode, setMode] = useState<'date' | 'time'>('date');
  const [error, setError] = useState<string | null>(null);
  const [tempDate, setTempDate] = useState<Date | null>(null);

  // Reset internal state every time the modal becomes visible. Mirrors
  // legacy `useEffect([visible, initialDate])`.
  useEffect(() => {
    if (visible) {
      setDate(initialDate ?? new Date());
      setTempDate(null);
      setError(null);
      setMode('date');
      setShowPicker(false);
    }
  }, [visible, initialDate]);

  const getMinimumDate = (): Date => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + minimumMinutes);
    d.setSeconds(d.getSeconds() + SCHEDULE_PICKER_GRACE_SECONDS);
    return d;
  };

  const validateAndSetDate = (newDate: Date): void => {
    if (newDate.getTime() <= getMinimumDate().getTime()) {
      setError(
        `Please select a time at least ${minimumMinutes} minutes from now`,
      );
      return;
    }
    setError(null);
    setDate(newDate);
    setTempDate(null);
    setMode('date');
  };

  const handleDateChange = (
    event: DateTimePickerEvent,
    selectedDate?: Date,
  ): void => {
    logger.debug('handleDateChange', { type: event.type, mode });
    if (event.type === 'dismissed') {
      setShowPicker(false);
      if (Platform.OS === 'android' && mode === 'date') {
        setTempDate(null);
        setMode('date');
      }
      return;
    }
    const currentDate = selectedDate ?? date;
    if (Platform.OS === 'android') {
      setShowPicker(false);
      if (mode === 'date') {
        // Stash the picked date; open the time picker.
        setTempDate(currentDate);
        setMode('time');
        setShowPicker(true);
      } else {
        // Combine the previously-picked date with the just-picked time.
        const finalDate = tempDate
          ? new Date(
              tempDate.getFullYear(),
              tempDate.getMonth(),
              tempDate.getDate(),
              currentDate.getHours(),
              currentDate.getMinutes(),
            )
          : currentDate;
        validateAndSetDate(finalDate);
      }
    } else {
      validateAndSetDate(currentDate);
    }
  };

  const showDatepicker = (): void => {
    setMode('date');
    setShowPicker(true);
    setTempDate(null);
  };

  const handleSchedule = (): void => {
    if (date.getTime() <= getMinimumDate().getTime()) {
      setError(
        `Please select a time at least ${minimumMinutes} minutes from now`,
      );
      return;
    }
    logger.debug('handleSchedule', { iso: date.toISOString() });
    onSchedule(date);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
      testID="schedule-datetime-picker"
    >
      <View className="flex-1 justify-end bg-black/50">
        <View className="rounded-t-3xl bg-card p-6 dark:bg-card-dark">
          <View className="mb-6 flex-row items-center justify-between">
            <Text className="text-xl font-semibold text-foreground">
              {title}
            </Text>
            <Pressable
              testID="schedule-datetime-picker-close"
              accessibilityRole="button"
              accessibilityLabel="Close schedule picker"
              onPress={onClose}
            >
              <Text className="text-2xl text-foreground">×</Text>
            </Pressable>
          </View>

          <View className="mb-6">
            <Text className="mb-2 text-base text-muted-foreground">
              Pick a date and time
            </Text>
            <Pressable
              testID="schedule-datetime-picker-row"
              onPress={showDatepicker}
              accessibilityRole="button"
              accessibilityLabel="Open date picker"
              className="flex-row items-center justify-between rounded-lg bg-muted p-4"
            >
              <Text className="text-foreground">
                {formatScheduleDateTime(date)}
              </Text>
            </Pressable>
            {error !== null && (
              <Text
                testID="schedule-datetime-picker-error"
                className="mt-2 text-sm text-destructive"
              >
                {error}
              </Text>
            )}
          </View>

          {Platform.OS === 'ios' ? (
            <DateTimePicker
              testID="schedule-datetime-picker-ios"
              value={date}
              mode="datetime"
              is24Hour={false}
              display="spinner"
              onChange={handleDateChange}
              minimumDate={getMinimumDate()}
              style={{ height: 180, width: '100%' }}
            />
          ) : showPicker ? (
            <DateTimePicker
              testID="schedule-datetime-picker-android"
              value={mode === 'time' && tempDate ? tempDate : date}
              mode={mode}
              is24Hour={false}
              display="default"
              onChange={handleDateChange}
              // Only the date step enforces a minimum — the time step
              // operates on the already-validated date. `exactOptionalPropertyTypes`
              // makes us spread the prop instead of passing `undefined`.
              {...(mode === 'date' ? { minimumDate: getMinimumDate() } : {})}
            />
          ) : null}

          <Pressable
            testID="schedule-datetime-picker-confirm"
            accessibilityRole="button"
            accessibilityLabel={buttonText}
            onPress={handleSchedule}
            className="rounded-lg bg-primary px-6 py-4 active:opacity-80"
          >
            <Text className="text-center text-lg font-semibold text-primary-foreground">
              {buttonText}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
