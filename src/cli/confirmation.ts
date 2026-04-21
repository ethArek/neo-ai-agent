export type ConfirmationMode = "interactive" | "one-shot";

export interface ConfirmationGuidance {
  title: string;
  lines: string[];
}

export function buildConfirmationGuidance(
  mode: ConfirmationMode,
): ConfirmationGuidance {
  if (mode === "interactive") {
    return {
      title: "Confirmation",
      lines: [
        "Action status: prepared only. Nothing has been sent yet.",
        'Next step: type "Confirm" to sign and broadcast.',
        'If you do not want to continue, type "Cancel".',
      ],
    };
  }

  return {
    title: "Confirmation",
    lines: [
      "Action status: prepared only. Nothing has been sent yet.",
      "One-shot commands cannot be confirmed later because this session ends after the response.",
      'Next step: run `npm run cli -- interactive`, repeat the request, then type "Confirm".',
    ],
  };
}
