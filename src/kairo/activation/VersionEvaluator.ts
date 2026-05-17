import type { SemVer } from "@kairo-js/properties";
import { SemVerUtils } from "@kairo-js/utils";
import type { ComparatorExpression, VersionExpression, WildcardExpression } from "./VersionParser";

export interface VersionEvaluationResult {
    readonly satisfied: boolean;
    readonly prereleaseOnly: boolean;
}

export interface EvaluateOptions {
    readonly includePrerelease?: boolean;
}

export class VersionEvaluator {
    evaluate(
        version: SemVer,
        expression: VersionExpression,
        options?: EvaluateOptions,
    ): VersionEvaluationResult {
        const includePrerelease = options?.includePrerelease ?? false;

        if (!includePrerelease && SemVerUtils.isPrerelease(version)) {
            const prereleaseSatisfied = this.satisfiesInternal(version, expression);

            return {
                satisfied: false,
                prereleaseOnly: prereleaseSatisfied,
            };
        }

        return {
            satisfied: this.satisfiesInternal(version, expression),
            prereleaseOnly: false,
        };
    }

    private satisfiesInternal(version: SemVer, expression: VersionExpression): boolean {
        switch (expression.type) {
            case "group":
                return this.satisfiesInternal(version, expression.expression);

            case "and":
                return (
                    this.satisfiesInternal(version, expression.left) &&
                    this.satisfiesInternal(version, expression.right)
                );

            case "or":
                return (
                    this.satisfiesInternal(version, expression.left) ||
                    this.satisfiesInternal(version, expression.right)
                );

            case "version":
                return SemVerUtils.equals(version, expression.version);

            case "wildcard":
                return this.evaluateWildcard(version, expression);

            case "range":
                return (
                    SemVerUtils.compare(version, expression.from) >= 0 &&
                    SemVerUtils.compare(version, expression.to) < 0
                );

            case "comparator":
                return this.evaluateComparator(version, expression);

            case "unresolved":
                return false;
        }
    }

    private evaluateComparator(version: SemVer, expression: ComparatorExpression): boolean {
        const compared = SemVerUtils.compare(version, expression.version);

        switch (expression.operator) {
            case "=":
                return compared === 0;

            case ">":
                return compared > 0;

            case ">=":
                return compared >= 0;

            case "<":
                return compared < 0;

            case "<=":
                return compared <= 0;

            case "^":
                return version.major === expression.version.major && compared >= 0;

            case "~":
                return (
                    version.major === expression.version.major &&
                    version.minor === expression.version.minor &&
                    compared >= 0
                );
        }
    }

    private evaluateWildcard(version: SemVer, expression: WildcardExpression): boolean {
        if (expression.major == null) {
            return true;
        }

        if (version.major !== expression.major) {
            return false;
        }

        if (expression.minor == null) {
            return true;
        }

        return version.minor === expression.minor;
    }
}
