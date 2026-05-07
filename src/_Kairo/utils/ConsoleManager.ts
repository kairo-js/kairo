import { properties } from "../../properties";

export enum ConsoleTimeFormat {
    TimeOnly,
    DateTime,
    None,
}

export class ConsoleManager {
    private static readonly JST_OFFSET_MS = 9 * 60 * 60 * 1000;

    private static getJstDate(): Date {
        return new Date(Date.now() + this.JST_OFFSET_MS);
    }

    private static pad(value: number, length = 2): string {
        return value.toString().padStart(length, "0");
    }

    private static formatTime(format: ConsoleTimeFormat): string {
        if (format === ConsoleTimeFormat.None) return "";

        const d = this.getJstDate();

        const date = `${d.getUTCFullYear()}/${this.pad(d.getUTCMonth() + 1)}/${this.pad(d.getUTCDate())}`;
        const time = `${this.pad(d.getUTCHours())}:${this.pad(d.getUTCMinutes())}:${this.pad(d.getUTCSeconds())}.${this.pad(d.getUTCMilliseconds(), 3)}`;

        switch (format) {
            case ConsoleTimeFormat.DateTime:
                return `${date} ${time}`;
            case ConsoleTimeFormat.TimeOnly:
            default:
                return time;
        }
    }

    private static buildPrefix(level: string, timeFormat: ConsoleTimeFormat): string {
        const time = this.formatTime(timeFormat);
        return time
            ? `[${properties.header.name}][${time}][${level}]`
            : `[${properties.header.name}][${level}]`;
    }

    static log(message: string, timeFormat: ConsoleTimeFormat = ConsoleTimeFormat.TimeOnly): void {
        console.log(`${this.buildPrefix("Log", timeFormat)} ${message}`);
    }

    static warn(message: string, timeFormat: ConsoleTimeFormat = ConsoleTimeFormat.TimeOnly): void {
        console.warn(`${this.buildPrefix("Warning", timeFormat)} ${message}`);
    }

    static error(
        message: string,
        timeFormat: ConsoleTimeFormat = ConsoleTimeFormat.TimeOnly,
    ): void {
        console.error(`${this.buildPrefix("Error", timeFormat)} ${message}`);
    }
}
