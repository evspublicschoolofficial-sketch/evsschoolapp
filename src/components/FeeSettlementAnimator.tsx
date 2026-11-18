import React, { useEffect, useRef, useState } from 'react';

export interface SettlementTransitionState {
  /** True for ~4.5s immediately after a due balance transitions from > 0 to <= 0 */
  justSettled: boolean;
  /** True while the numeric balance is actively counting down to 0 */
  isCountingDown: boolean;
  /** Smoothly interpolated rupee amount during countdown, or currentAmount once finished */
  displayAmount: number;
  /** Previous positive due amount before clearance */
  previousDueAmount: number;
  /** Unique trigger counter to re-run CSS keyframe animations on settlement */
  settlementEpoch: number;
}

/**
 * Tracks a single fee entity (one student or combined family) across renders.
 * Fires a smooth count-down + celebratory settlement state only when `currentDue`
 * transitions from > 0 to <= 0 for the SAME entityKey (avoiding false positives
 * when switching between siblings).
 */
export function useFeeSettlementTransition(
  entityKey: string | undefined | null,
  currentDue: number,
  options?: { durationMs?: number; celebrationHoldMs?: number }
): SettlementTransitionState {
  const durationMs = options?.durationMs ?? 780;
  const celebrationHoldMs = options?.celebrationHoldMs ?? 4500;

  const normalizedKey = String(entityKey || '').trim();
  const normalizedDue = Math.max(0, Math.round(Number(currentDue) || 0));

  const lastTrackedByEntityRef = useRef<Record<string, number>>({});
  const activeKeyRef = useRef<string>(normalizedKey);
  const rafRef = useRef<number | null>(null);
  const holdTimerRef = useRef<number | null>(null);

  const [state, setState] = useState<SettlementTransitionState>({
    justSettled: false,
    isCountingDown: false,
    displayAmount: normalizedDue,
    previousDueAmount: 0,
    settlementEpoch: 0,
  });

  useEffect(() => {
    if (!normalizedKey) {
      setState({
        justSettled: false,
        isCountingDown: false,
        displayAmount: normalizedDue,
        previousDueAmount: 0,
        settlementEpoch: 0,
      });
      return;
    }

    const keyChanged = activeKeyRef.current !== normalizedKey;
    activeKeyRef.current = normalizedKey;

    const prevRecordedDue = lastTrackedByEntityRef.current[normalizedKey];
    lastTrackedByEntityRef.current[normalizedKey] = normalizedDue;

    // Cancel pending animation frame if key changed or new value arrived
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (keyChanged) {
      if (holdTimerRef.current !== null) {
        window.clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      setState((prev) => ({
        justSettled: false,
        isCountingDown: false,
        displayAmount: normalizedDue,
        previousDueAmount: 0,
        settlementEpoch: prev.settlementEpoch,
      }));
      return;
    }

    // Genuine debt settlement: previously > 0, now 0 for the SAME entity!
    if (prevRecordedDue !== undefined && prevRecordedDue > 0 && normalizedDue <= 0) {
      if (holdTimerRef.current !== null) {
        window.clearTimeout(holdTimerRef.current);
      }

      const startVal = prevRecordedDue;
      const startTime = performance.now();

      setState((prev) => ({
        justSettled: true,
        isCountingDown: true,
        displayAmount: startVal,
        previousDueAmount: startVal,
        settlementEpoch: prev.settlementEpoch + 1,
      }));

      const step = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / durationMs);
        // Cubic ease-out for crisp deceleration to 0
        const eased = 1 - Math.pow(1 - progress, 3);
        const currentVal = Math.max(0, Math.round(startVal * (1 - eased)));

        setState((prev) => ({
          ...prev,
          isCountingDown: progress < 1,
          displayAmount: currentVal,
        }));

        if (progress < 1) {
          rafRef.current = requestAnimationFrame(step);
        } else {
          rafRef.current = null;
        }
      };

      rafRef.current = requestAnimationFrame(step);

      holdTimerRef.current = window.setTimeout(() => {
        setState((prev) => ({
          ...prev,
          justSettled: false,
          isCountingDown: false,
        }));
        holdTimerRef.current = null;
      }, celebrationHoldMs);
    } else {
      // Normal balance update (e.g. partial payment or new month billing)
      setState((prev) => ({
        ...prev,
        isCountingDown: false,
        displayAmount: normalizedDue,
        justSettled: normalizedDue > 0 ? false : prev.justSettled,
      }));
    }
  }, [normalizedKey, normalizedDue, durationMs, celebrationHoldMs]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
    };
  }, []);

  return state;
}

interface AnimatedSettledCurrencyProps {
  /** Whether the account still has pending dues */
  hasDues: boolean;
  /** Whether the account is in advance/credit balance */
  isAdvance: boolean;
  /** Positive balance due */
  balance: number;
  /** Advance amount if isAdvance */
  advanceAmount: number;
  /** Settlement transition state from useFeeSettlementTransition */
  settlement: SettlementTransitionState;
  className?: string;
}

/**
 * Renders the animated balance amount in Parent Portal fee cards.
 * Counts down smoothly from the previous due to ₹0 and animates the settled text
 * when transitioning from 'Due' -> 'Paid / Cleared'.
 */
export const AnimatedSettledCurrency: React.FC<AnimatedSettledCurrencyProps> = ({
  hasDues,
  isAdvance,
  balance,
  advanceAmount,
  settlement,
  className = '',
}) => {
  const showCountingDown = settlement.justSettled && settlement.isCountingDown;

  if (showCountingDown) {
    return (
      <span className={`inline-flex items-baseline gap-2 tabular-nums ${className}`}>
        <span className="line-through text-rose-400/80 text-base font-bold">
          ₹{settlement.previousDueAmount.toLocaleString('en-IN')}
        </span>
        <span className="text-emerald-700 transition-colors">
          ₹{settlement.displayAmount.toLocaleString('en-IN')}
        </span>
      </span>
    );
  }

  return (
    <span
      key={settlement.justSettled ? `settled-${settlement.settlementEpoch}` : hasDues ? 'due' : isAdvance ? 'adv' : 'paid'}
      className={`inline-flex items-center gap-2 tabular-nums transition-colors duration-500 ${
        settlement.justSettled ? 'animate-fee-text-settle' : ''
      } ${className}`}
    >
      {settlement.justSettled && !hasDues && settlement.previousDueAmount > 0 && (
        <span className="text-xs font-bold line-through text-slate-400">
          ₹{settlement.previousDueAmount.toLocaleString('en-IN')}
        </span>
      )}
      <span>
        {isAdvance
          ? `-₹${advanceAmount.toLocaleString('en-IN')}`
          : `₹${balance.toLocaleString('en-IN')}`}
      </span>
      {settlement.justSettled && !hasDues && (
        <span className="inline-flex items-center gap-1 text-[11px] font-black px-2 py-0.5 rounded-full bg-emerald-600 text-white shadow-xs animate-fee-badge-pop">
          <i className="fa-solid fa-check"></i>
          <span>Cleared!</span>
        </span>
      )}
    </span>
  );
};
