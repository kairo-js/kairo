import type { SemVer } from "@kairo-js/properties";

export type VersionExpression =
    | AndExpression
    | OrExpression
    | GroupExpression
    | ComparatorExpression
    | RangeExpression
    | WildcardExpression
    | VersionLiteralExpression
    | UnresolvedExpression;

export interface AndExpression {
    readonly type: "and";
    readonly left: VersionExpression;
    readonly right: VersionExpression;
}

export interface OrExpression {
    readonly type: "or";
    readonly left: VersionExpression;
    readonly right: VersionExpression;
}

export interface GroupExpression {
    readonly type: "group";
    readonly expression: VersionExpression;
}

export interface ComparatorExpression {
    readonly type: "comparator";
    readonly operator: "=" | ">" | ">=" | "<" | "<=" | "^" | "~";
    readonly version: SemVer;
}

export interface RangeExpression {
    readonly type: "range";
    readonly from: SemVer;
    readonly to: SemVer;
}

export interface WildcardExpression {
    readonly type: "wildcard";
    readonly major?: number;
    readonly minor?: number;
}

export interface VersionLiteralExpression {
    readonly type: "version";
    readonly version: SemVer;
}

export interface UnresolvedExpression {
    readonly type: "unresolved";
    readonly reason: string;
    readonly token?: string;
}

type OperatorTokenValue = "&" | "|" | "(" | ")" | "=" | ">" | "<" | ">=" | "<=" | "^" | "~" | "-";

export type Token =
    | {
          readonly type: "operator";
          readonly value: OperatorTokenValue;
      }
    | {
          readonly type: "value";
          readonly value: string;
      };

export class VersionParser {
    private tokens: readonly Token[] = [];
    private position = 0;

    parse(input: string): VersionExpression {
        const normalized = input.replace(/\s+/g, "");

        if (normalized.length === 0) {
            return this.unresolved("empty_expression");
        }

        this.tokens = this.tokenize(normalized);
        this.position = 0;

        const expression = this.parseOr();

        if (this.position < this.tokens.length) {
            return this.unresolved("unexpected_token", this.peek()?.value);
        }

        return expression;
    }

    private parseOr(): VersionExpression {
        let left = this.parseAnd();

        while (this.match("|")) {
            const right = this.parseAnd();

            left = {
                type: "or",
                left,
                right,
            };
        }

        return left;
    }

    private parseAnd(): VersionExpression {
        let left = this.parsePrimary();

        while (this.match("&")) {
            const right = this.parsePrimary();

            left = {
                type: "and",
                left,
                right,
            };
        }

        return left;
    }

    private parsePrimary(): VersionExpression {
        if (this.match("(")) {
            const expression = this.parseOr();

            if (!this.match(")")) {
                return this.unresolved("missing_closing_parenthesis");
            }

            return {
                type: "group",
                expression,
            };
        }

        return this.parseAtomic();
    }

    private parseAtomic(): VersionExpression {
        const token = this.next();

        if (!token) {
            return this.unresolved("unexpected_eof");
        }

        if (token.type === "operator") {
            switch (token.value) {
                case "=":
                case ">":
                case ">=":
                case "<":
                case "<=":
                case "^":
                case "~": {
                    const valueToken = this.next();

                    if (!valueToken || valueToken.type !== "value") {
                        return this.unresolved("missing_version", token.value);
                    }

                    if (
                        (token.value === "^" || token.value === "~") &&
                        this.isWildcardVersion(valueToken.value)
                    ) {
                        return this.unresolved(
                            "invalid_wildcard_operator_combination",
                            valueToken.value,
                        );
                    }

                    const version = this.parseVersion(valueToken.value);

                    if (!version) {
                        return this.unresolved("invalid_version", valueToken.value);
                    }

                    return {
                        type: "comparator",
                        operator: token.value,
                        version,
                    };
                }

                default:
                    return this.unresolved("unexpected_operator", token.value);
            }
        }

        if (token.value === "*") {
            return {
                type: "wildcard",
            };
        }

        if (token.value.includes("x") || token.value.includes("*")) {
            return this.parseWildcard(token.value);
        }

        if (this.peek()?.type === "operator" && this.peek()?.value === "-") {
            this.next();

            const toToken = this.next();

            if (!toToken || toToken.type !== "value") {
                return this.unresolved("invalid_range", token.value);
            }

            const from = this.parseVersion(token.value);

            const to = this.parseVersion(toToken.value);

            if (!from || !to) {
                return this.unresolved("invalid_range", `${token.value}-${toToken.value}`);
            }

            return {
                type: "range",
                from,
                to,
            };
        }

        const version = this.parseVersion(token.value);

        if (!version) {
            return this.unresolved("invalid_version", token.value);
        }

        const dotCount = token.value.split("-")[0]?.split("+")[0]?.split(".").length;

        if (dotCount === 1) {
            return {
                type: "comparator",
                operator: "^",
                version,
            };
        }

        if (dotCount === 2) {
            return {
                type: "comparator",
                operator: "~",
                version,
            };
        }

        return {
            type: "version",
            version,
        };
    }

    private parseWildcard(value: string): VersionExpression {
        const normalized = value.replaceAll("*", "x");

        const parts = normalized.split(".");

        if (parts.length === 1) {
            const majorPart = parts[0];

            if (!majorPart) {
                return this.unresolved("invalid_wildcard", value);
            }

            if (majorPart === "x") {
                return {
                    type: "wildcard",
                };
            }

            const major = Number(majorPart);

            if (Number.isNaN(major)) {
                return this.unresolved("invalid_wildcard", value);
            }

            return {
                type: "wildcard",
                major,
            };
        }

        if (parts.length === 2) {
            const majorPart = parts[0];
            const minorPart = parts[1];

            if (!majorPart || !minorPart || minorPart !== "x") {
                return this.unresolved("invalid_wildcard", value);
            }

            const major = Number(majorPart);

            if (Number.isNaN(major)) {
                return this.unresolved("invalid_wildcard", value);
            }

            return {
                type: "wildcard",
                major,
            };
        }

        if (parts.length === 3) {
            const majorPart = parts[0];
            const minorPart = parts[1];
            const patchPart = parts[2];

            if (!majorPart || !minorPart || !patchPart || patchPart !== "x") {
                return this.unresolved("invalid_wildcard", value);
            }

            const major = Number(majorPart);
            const minor = Number(minorPart);

            if (Number.isNaN(major) || Number.isNaN(minor)) {
                return this.unresolved("invalid_wildcard", value);
            }

            return {
                type: "wildcard",
                major,
                minor,
            };
        }

        return this.unresolved("invalid_wildcard", value);
    }

    private parseVersion(value: string): SemVer | null {
        const buildSplit = value.split("+");

        const main = buildSplit[0];

        if (!main) {
            return null;
        }

        const build = buildSplit[1];

        const prereleaseSplit = main.split("-");

        const core = prereleaseSplit[0];

        if (!core) {
            return null;
        }

        const prerelease = prereleaseSplit[1];

        const parts = core.split(".");

        if (parts.length > 3) {
            return null;
        }

        const majorPart = parts[0];

        if (!majorPart) {
            return null;
        }

        const minorPart = parts[1] ?? "0";
        const patchPart = parts[2] ?? "0";

        const major = Number(majorPart);
        const minor = Number(minorPart);
        const patch = Number(patchPart);

        if ([major, minor, patch].some((v) => Number.isNaN(v))) {
            return null;
        }

        return {
            major,
            minor,
            patch,
            prerelease,
            build,
        };
    }

    private tokenize(input: string): readonly Token[] {
        const tokens: Token[] = [];

        let current = "";

        const pushCurrent = (): void => {
            if (current.length === 0) {
                return;
            }

            tokens.push({
                type: "value",
                value: current,
            });

            current = "";
        };

        for (let i = 0; i < input.length; i++) {
            const char = input[i];

            if (!char) {
                continue;
            }

            const next = input[i + 1];

            if ((char === ">" || char === "<") && next === "=") {
                pushCurrent();

                tokens.push({
                    type: "operator",
                    value: `${char}=` as ">=" | "<=",
                });

                i++;

                continue;
            }

            if (["&", "|", "(", ")", "=", ">", "<", "^", "~", "-"].includes(char)) {
                pushCurrent();

                tokens.push({
                    type: "operator",
                    value: char as never,
                });

                continue;
            }

            current += char;
        }

        pushCurrent();

        return tokens;
    }

    private isWildcardVersion(value: string): boolean {
        return value.includes("x") || value.includes("*");
    }

    private match(value: string): boolean {
        const token = this.peek();

        if (token?.type === "operator" && token.value === value) {
            this.position++;

            return true;
        }

        return false;
    }

    private peek(): Token | undefined {
        return this.tokens[this.position];
    }

    private next(): Token | undefined {
        return this.tokens[this.position++];
    }

    private unresolved(reason: string, token?: string): UnresolvedExpression {
        return {
            type: "unresolved",
            reason,
            token,
        };
    }
}
