import { ConsoleSources } from '@shared/contracts/console';
import { asClientSlug } from '@shared/contracts/ids';
import { describe, expect, it } from 'vitest';

import { createConsoleHub } from '@main/infra/consoleHub';

const SLUG = asClientSlug('test-client');

const PARTIAL_EVENT =
  '<log4j:Event logger="net.minecraft.crash" timestamp="1" level="ERROR" thread="main">';

const COMPLETE_EVENT = `<log4j:Event logger="net.minecraft.crash" timestamp="1" level="ERROR" thread="main">
  <log4j:Message><![CDATA[Fatal: game crashed]]></log4j:Message>
</log4j:Event>`;

describe('createConsoleHub', () => {
  it('isolates buffers between independently created instances', () => {
    const first = createConsoleHub();
    const second = createConsoleHub();

    first.recordSystem('only in first');

    expect(first.getInitial().lines).toHaveLength(1);
    expect(second.getInitial().lines).toHaveLength(0);
  });

  it('flushes a partial log4j event into the buffer on endSession', () => {
    const hub = createConsoleHub();

    // A partial event holds in the stream parser: feed alone ingests nothing.
    hub.recordMinecraft(SLUG, ConsoleSources.STDERR, PARTIAL_EVENT);
    expect(hub.getInitial().lines).toHaveLength(0);

    hub.endSession(SLUG);

    const lines = hub.getInitial().lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]?.message).toContain('net.minecraft.crash');
  });

  it('parses a complete trailing crash event held until endSession', () => {
    const hub = createConsoleHub();

    // The closing tag arrives, so the parser emits the event on the same feed;
    // endSession then resets cleanly without re-emitting it.
    hub.recordMinecraft(SLUG, ConsoleSources.STDERR, COMPLETE_EVENT);
    const beforeEnd = hub.getInitial().lines.length;
    expect(beforeEnd).toBe(1);
    expect(hub.getInitial().lines[0]?.message).toContain('Fatal: game crashed');

    hub.endSession(SLUG);
    expect(hub.getInitial().lines).toHaveLength(beforeEnd);
  });
});
