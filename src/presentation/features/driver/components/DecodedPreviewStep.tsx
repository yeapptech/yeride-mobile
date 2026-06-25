import { Image, Text, View } from 'react-native';

import type { VinDecodeResult } from '@domain/services';
import { Button } from '@presentation/components/ui/Button';

interface DecodedPreviewStepProps {
  readonly decoded: VinDecodeResult;
  readonly isSubmitting: boolean;
  readonly onConfirm: () => void;
  readonly onEditManually: () => void;
}

/**
 * Read-only preview of NHTSA-decoded vehicle data. Shows the stock photo
 * when present (NHTSA SafetyRatings sometimes returns one), the basic
 * year / make / model / class line, and an eligibility banner if the
 * vehicle didn't pass the rideshare heuristics.
 *
 * Eligibility is informational, not gating — admin review is the final
 * gate (see `VinDecoderService.VinDecodeResult.isEligible` JSDoc). Drivers
 * with an `isEligible: false` decode can still register, then either edit
 * the data manually or wait for admin review.
 */
export function DecodedPreviewStep({
  decoded,
  isSubmitting,
  onConfirm,
  onEditManually,
}: DecodedPreviewStepProps) {
  return (
    <View className="mt-4 rounded-xl bg-card p-4">
      <Text className="mb-3 text-sm font-medium text-foreground">
        Vehicle details (auto-filled from VIN)
      </Text>

      {decoded.stockPhoto !== null && (
        <View className="mb-3 overflow-hidden rounded-lg bg-muted">
          <Image
            source={{ uri: decoded.stockPhoto }}
            className="h-40 w-full"
            resizeMode="contain"
            testID="decoded-preview-stock-photo"
          />
        </View>
      )}

      <SummaryRow label="Make" value={decoded.make} />
      <SummaryRow label="Model" value={decoded.model} />
      <SummaryRow label="Year" value={String(decoded.year)} />
      {decoded.trim !== null && (
        <SummaryRow label="Trim" value={decoded.trim} />
      )}
      {decoded.bodyClass !== null && (
        <SummaryRow label="Body" value={decoded.bodyClass} />
      )}
      <SummaryRow label="Class" value={decoded.vehicleClass} />
      {decoded.seats !== null && (
        <SummaryRow label="Seats" value={String(decoded.seats)} />
      )}
      {decoded.doors !== null && (
        <SummaryRow label="Doors" value={String(decoded.doors)} />
      )}

      {!decoded.isEligible && (
        <View
          className="mt-3 rounded-lg border border-warning/30 bg-warning/10 p-3"
          testID="decoded-preview-ineligible-banner"
        >
          <Text className="text-xs text-warning">
            This vehicle doesn&apos;t meet the standard rideshare eligibility
            heuristics (≤15 years old, ≥4 doors, ≥4 seats, passenger vehicle).
            You can still register; admin review is the final gate.
          </Text>
        </View>
      )}

      <View className="mt-4 flex-row gap-2">
        <Button
          label={isSubmitting ? 'Registering…' : 'Confirm & register'}
          onPress={onConfirm}
          disabled={isSubmitting}
          accessibilityLabel="Confirm vehicle and register"
          testID="decoded-preview-confirm"
          className="flex-1"
        />
        <Button
          label="Edit manually"
          onPress={onEditManually}
          disabled={isSubmitting}
          variant="secondary"
          testID="decoded-preview-edit-manually"
        />
      </View>
    </View>
  );
}

function SummaryRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <View className="mb-1.5 flex-row">
      <Text className="w-24 text-xs uppercase text-muted-foreground">
        {label}
      </Text>
      <Text className="flex-1 text-sm text-foreground">{value}</Text>
    </View>
  );
}
