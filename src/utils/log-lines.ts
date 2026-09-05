import { appendFileSync, closeSync, openSync, readSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

// Watch only the first 64 KiB; raw and combined logs remain complete.
const WATCH_WINDOW_BYTES = 64 * 1024;
const NEWLINE = Buffer.from("\n");

/** Batches tagged lines without retaining a whole oversized spanning line. */
class LogBatch {
  private readonly buffer = Buffer.allocUnsafe(64 * 1024);
  private length = 0;

  constructor(private readonly file: string) {}

  write(data: Buffer): void {
    for (let offset = 0; offset < data.length; ) {
      const count = Math.min(
        data.length - offset,
        this.buffer.length - this.length,
      );
      data.copy(this.buffer, this.length, offset, offset + count);
      this.length += count;
      offset += count;
      if (this.length === this.buffer.length) this.flush();
    }
  }

  flush(): void {
    if (this.length === 0) return;
    appendFileSync(this.file, this.buffer.subarray(0, this.length));
    this.length = 0;
  }
}

/** Tracks pending lines by offsets in the already-written raw log, not strings. */
export class LogLines {
  private offset = 0;
  private lineStart = 0;
  private afterCR = false;
  private readonly tag: Buffer;

  constructor(
    private readonly rawFile: string,
    private readonly combinedFile: string,
    tag: string,
  ) {
    this.tag = Buffer.from(tag);
  }

  push(data: Buffer): string[] {
    const lines: string[] = [];
    const batch = new LogBatch(this.combinedFile);
    for (let i = 0; i < data.length; i++) {
      const byte = data[i];
      if (this.afterCR && byte === 10) {
        this.lineStart = this.offset + i + 1;
        this.afterCR = false;
        continue;
      }
      this.afterCR = byte === 13;
      if (byte !== 10 && byte !== 13) continue;
      lines.push(this.complete(this.offset + i, data, batch));
      this.lineStart = this.offset + i + 1;
    }
    batch.flush();
    this.offset += data.length;
    return lines;
  }

  flush(): string[] {
    if (this.lineStart === this.offset) return [];
    const batch = new LogBatch(this.combinedFile);
    const line = this.complete(this.offset, Buffer.alloc(0), batch);
    batch.flush();
    this.lineStart = this.offset;
    return [line];
  }

  private complete(end: number, data: Buffer, batch: LogBatch): string {
    batch.write(this.tag);
    const decoder = new StringDecoder("utf8");
    let watchLine = "";
    let remaining = WATCH_WINDOW_BYTES;
    const consume = (chunk: Buffer) => {
      batch.write(chunk);
      if (remaining > 0) {
        const count = Math.min(remaining, chunk.length);
        watchLine += decoder.write(chunk.subarray(0, count));
        remaining -= count;
      }
    };

    // Only bytes from earlier data events need a disk read. The current
    // event already holds the rest, including all wholly contained lines.
    if (this.lineStart < this.offset) {
      const fd = openSync(this.rawFile, "r");
      try {
        const buffer = Buffer.allocUnsafe(
          Math.min(WATCH_WINDOW_BYTES, this.offset - this.lineStart),
        );
        for (let position = this.lineStart; position < this.offset; ) {
          const count = readSync(
            fd,
            buffer,
            0,
            Math.min(buffer.length, this.offset - position),
            position,
          );
          if (count === 0) throw new Error("Unexpected end of process log");
          consume(buffer.subarray(0, count));
          position += count;
        }
      } finally {
        closeSync(fd);
      }
    }
    consume(
      data.subarray(
        Math.max(0, this.lineStart - this.offset),
        end - this.offset,
      ),
    );
    if (end - this.lineStart <= WATCH_WINDOW_BYTES) watchLine += decoder.end();
    batch.write(NEWLINE);
    return watchLine;
  }
}
