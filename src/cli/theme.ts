const jsonTokenPattern =
  /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*")(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

function shouldUseColor(): boolean {
  return process.stdout.isTTY && process.env.NO_COLOR === undefined;
}

function applyAnsi(
  value: string,
  codes: number[],
  colorEnabled: boolean,
): string {
  if (!colorEnabled || value.length === 0) {
    return value;
  }

  return `\u001b[${codes.join(";")}m${value}\u001b[0m`;
}

function highlightJsonToken(token: string, colorEnabled: boolean): string {
  if (/^"/.test(token)) {
    return applyAnsi(token, [32], colorEnabled);
  }

  if (token === "true" || token === "false") {
    return applyAnsi(token, [35], colorEnabled);
  }

  if (token === "null") {
    return applyAnsi(token, [31], colorEnabled);
  }

  return applyAnsi(token, [33], colorEnabled);
}

export interface CliTheme {
  readonly colorEnabled: boolean;
  renderBanner(): string;
  renderPrompt(): string;
  renderPrimaryMessage(message: string): string;
  renderLabel(label: string, value: string): string;
  renderSectionTitle(title: string): string;
  renderSuccess(message: string): string;
  renderWarning(message: string): string;
  renderError(message: string): string;
  renderMuted(message: string): string;
  renderJson(value: unknown): string;
}

export function createCliTheme(colorEnabled = shouldUseColor()): CliTheme {
  return {
    colorEnabled,
    renderBanner(): string {
      const title = applyAnsi("Neo AI Agent", [1, 36], colorEnabled);
      const subtitle = applyAnsi(
        "Interactive mode with confirmation-safe blockchain actions",
        [2, 37],
        colorEnabled,
      );

      return `${title}\n${subtitle}`;
    },
    renderPrompt(): string {
      return applyAnsi("neo> ", [1, 34], colorEnabled);
    },
    renderPrimaryMessage(message: string): string {
      return applyAnsi(message, [1, 37], colorEnabled);
    },
    renderLabel(label: string, value: string): string {
      const styledLabel = applyAnsi(`${label}:`, [1, 36], colorEnabled);
      const styledValue = applyAnsi(value, [37], colorEnabled);

      return `${styledLabel} ${styledValue}`;
    },
    renderSectionTitle(title: string): string {
      return applyAnsi(title, [1, 35], colorEnabled);
    },
    renderSuccess(message: string): string {
      return applyAnsi(message, [1, 32], colorEnabled);
    },
    renderWarning(message: string): string {
      return applyAnsi(message, [1, 33], colorEnabled);
    },
    renderError(message: string): string {
      return applyAnsi(message, [1, 31], colorEnabled);
    },
    renderMuted(message: string): string {
      return applyAnsi(message, [2, 37], colorEnabled);
    },
    renderJson(value: unknown): string {
      const serialized = JSON.stringify(value, null, 2);

      if (!colorEnabled) {
        return serialized;
      }

      return serialized.replace(
        jsonTokenPattern,
        (match: string, quotedToken: string, isKey: string | undefined) => {
          if (quotedToken && isKey) {
            return `${applyAnsi(quotedToken, [1, 36], colorEnabled)}${isKey}`;
          }

          return highlightJsonToken(match, colorEnabled);
        },
      );
    },
  };
}
