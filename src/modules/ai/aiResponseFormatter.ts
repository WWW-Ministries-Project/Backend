import { AiDisplay, AiDisplayBlock, AiDisplaySection, AiDisplayTable } from "./aiTypes";

type WorkingSection = {
  heading: string;
  blocks: AiDisplayBlock[];
  paragraphs: string[];
  items: string[];
  tables: AiDisplayTable[];
  paragraphBuffer: string[];
  listBuffer: string[];
};

const DEFAULT_SECTION_HEADING = "Response";
const GENERIC_SECTION_HEADINGS = new Set([
  "response",
  "details",
  "overview",
  "summary",
]);

export class AiResponseFormatter {
  format(reply: string): AiDisplay {
    const markdown = this.normalizeReply(reply);
    if (!markdown) {
      return {
        format: "structured_markdown_v1",
        title: null,
        summary: null,
        sections: [],
        markdown: "",
        plain_text: "",
      };
    }

    const title = this.extractLeadingTitle(markdown);
    const body = title ? this.removeLeadingTitle(markdown) : markdown;
    const sections = this.parseSections(body);
    const plainText = this.toPlainText(markdown);
    const summary = this.extractSummary(sections, plainText);
    const dedupedSections = this.removeSummaryDuplication(summary, sections);

    return {
      format: "structured_markdown_v1",
      title,
      summary,
      sections: dedupedSections,
      markdown,
      plain_text: plainText,
    };
  }

  private normalizeReply(reply: string): string {
    return String(reply || "")
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  private extractLeadingTitle(markdown: string): string | null {
    const lines = markdown.split("\n");
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      const match = line.match(/^#\s+(.+)$/);
      if (!match?.[1]) {
        return null;
      }

      const title = this.cleanInlineText(match[1]);
      return title || null;
    }

    return null;
  }

  private removeLeadingTitle(markdown: string): string {
    const lines = markdown.split("\n");
    let removed = false;

    const kept = lines.filter((rawLine) => {
      if (removed) {
        return true;
      }

      const line = rawLine.trim();
      if (!line) {
        return false;
      }

      if (/^#\s+.+$/.test(line)) {
        removed = true;
        return false;
      }

      removed = true;
      return true;
    });

    return kept.join("\n").trim();
  }

  private parseSections(markdown: string): AiDisplaySection[] {
    if (!markdown) {
      return [];
    }

    const sections: AiDisplaySection[] = [];
    let current = this.createSection(DEFAULT_SECTION_HEADING);
    let sawExplicitSection = false;
    const lines = markdown.split("\n");

    for (let index = 0; index < lines.length; index += 1) {
      const trimmed = lines[index].trim();

      if (!trimmed) {
        this.flushBuffers(current);
        continue;
      }

      const heading = this.extractSectionHeading(trimmed);
      if (heading) {
        this.flushBuffers(current);
        if (this.hasSectionContent(current)) {
          sections.push(this.finalizeSection(current));
        }

        current = this.createSection(heading.heading);
        sawExplicitSection = true;

        if (heading.inlineText) {
          this.pushParagraph(current, heading.inlineText);
        }
        continue;
      }

      const table = this.parseMarkdownTable(lines, index);
      if (table) {
        this.flushBuffers(current);
        current.blocks.push({
          type: "table",
          columns: table.columns,
          rows: table.rows,
        });
        current.tables.push(table);
        index = table.nextIndex - 1;
        continue;
      }

      const listItem = this.extractListItem(trimmed);
      if (listItem) {
        this.flushParagraph(current);
        current.listBuffer.push(listItem);
        continue;
      }

      this.flushList(current);
      current.paragraphBuffer.push(trimmed);
    }

    this.flushBuffers(current);

    if (this.hasSectionContent(current) || !sawExplicitSection) {
      sections.push(this.finalizeSection(current));
    }

    return sections.filter((section) => this.hasPersistedSectionContent(section));
  }

  private extractSectionHeading(
    line: string,
  ): { heading: string; inlineText?: string } | null {
    const markdownMatch = line.match(/^##+\s+(.+)$/);
    if (markdownMatch?.[1]) {
      const heading = this.cleanInlineText(markdownMatch[1]);
      return heading ? { heading } : null;
    }

    const labeledMatch = line.match(/^([A-Z][A-Za-z0-9/&()' -]{1,50}):\s*(.*)$/);
    if (labeledMatch?.[1]) {
      const heading = this.cleanInlineText(labeledMatch[1]);
      if (!heading) {
        return null;
      }

      const inlineText = this.cleanInlineText(labeledMatch[2] || "");
      return inlineText ? { heading, inlineText } : { heading };
    }

    return null;
  }

  private extractListItem(line: string): string | null {
    const match = line.match(/^(?:[-*•]|\d+\.)\s+(.+)$/);
    if (!match?.[1]) {
      return null;
    }

    const value = this.cleanInlineText(match[1]);
    return value || null;
  }

  private parseMarkdownTable(
    lines: string[],
    startIndex: number,
  ): (AiDisplayTable & { nextIndex: number }) | null {
    if (startIndex + 2 >= lines.length) {
      return null;
    }

    const headerLine = lines[startIndex].trim();
    const dividerLine = lines[startIndex + 1].trim();
    if (
      !this.looksLikeMarkdownTableRow(headerLine) ||
      !this.isMarkdownTableDivider(dividerLine)
    ) {
      return null;
    }

    const columns = this.parseMarkdownTableCells(headerLine);
    if (columns.length < 2) {
      return null;
    }

    const rows: string[][] = [];
    let index = startIndex + 2;

    while (index < lines.length) {
      const candidate = lines[index].trim();
      if (!candidate || !this.looksLikeMarkdownTableRow(candidate)) {
        break;
      }

      const parsedCells = this.parseMarkdownTableCells(candidate);
      if (!parsedCells.length) {
        break;
      }

      rows.push(
        Array.from({ length: columns.length }, (_, columnIndex) =>
          this.cleanInlineText(parsedCells[columnIndex] || ""),
        ),
      );
      index += 1;
    }

    if (!rows.length) {
      return null;
    }

    return {
      columns,
      rows,
      nextIndex: index,
    };
  }

  private looksLikeMarkdownTableRow(line: string): boolean {
    return this.parseMarkdownTableCells(line).length >= 2;
  }

  private isMarkdownTableDivider(line: string): boolean {
    const cells = this.parseMarkdownTableCells(line);
    if (cells.length < 2) {
      return false;
    }

    return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
  }

  private parseMarkdownTableCells(line: string): string[] {
    const normalized = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    if (!normalized.includes("|")) {
      return [];
    }

    return normalized.split("|").map((cell) => this.cleanInlineText(cell));
  }

  private toPlainText(markdown: string): string {
    return markdown
      .replace(/```[\s\S]*?```/g, (block) =>
        block.replace(/```/g, "").trim(),
      )
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^\s*(?:[-*•]|\d+\.)\s+/gm, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[`*_>]/g, "")
      .replace(/\n{2,}/g, "\n\n")
      .trim();
  }

  private extractSummary(
    sections: AiDisplaySection[],
    plainText: string,
  ): string | null {
    for (const section of sections) {
      const paragraph = section.paragraphs.find((value) => value.trim().length > 0);
      if (paragraph) {
        return this.limitSummary(paragraph);
      }
    }

    const firstLine = plainText.split("\n").find((value) => value.trim().length > 0);
    return firstLine ? this.limitSummary(firstLine.trim()) : null;
  }

  private removeSummaryDuplication(
    summary: string | null,
    sections: AiDisplaySection[],
  ): AiDisplaySection[] {
    if (!summary || !sections.length) {
      return sections;
    }

    const [firstSection, ...rest] = sections;
    const firstParagraph = firstSection.paragraphs[0];
    if (!firstParagraph || firstParagraph !== summary) {
      return sections;
    }

    const remainingParagraphs = firstSection.paragraphs.slice(1);
    const remainingBlocks =
      firstSection.blocks[0]?.type === "paragraph" &&
      firstSection.blocks[0].text === summary
        ? firstSection.blocks.slice(1)
        : firstSection.blocks;
    if (
      remainingParagraphs.length === 0 &&
      remainingBlocks.length === 0 &&
      firstSection.items.length === 0 &&
      firstSection.tables.length === 0 &&
      GENERIC_SECTION_HEADINGS.has(firstSection.heading.trim().toLowerCase()) &&
      rest.length > 0
    ) {
      return rest;
    }

    return [
      {
        ...firstSection,
        blocks: remainingBlocks,
        paragraphs: remainingParagraphs,
      },
      ...rest,
    ].filter((section) => this.hasPersistedSectionContent(section));
  }

  private limitSummary(value: string): string {
    const normalized = value.trim();
    if (normalized.length <= 220) {
      return normalized;
    }

    return `${normalized.slice(0, 217).trimEnd()}...`;
  }

  private cleanInlineText(value: string): string {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .trim();
  }

  private createSection(heading: string): WorkingSection {
    return {
      heading,
      blocks: [],
      paragraphs: [],
      items: [],
      tables: [],
      paragraphBuffer: [],
      listBuffer: [],
    };
  }

  private flushBuffers(section: WorkingSection): void {
    this.flushParagraph(section);
    this.flushList(section);
  }

  private flushParagraph(section: WorkingSection): void {
    if (!section.paragraphBuffer.length) {
      return;
    }

    const value = this.cleanInlineText(section.paragraphBuffer.join(" "));
    section.paragraphBuffer = [];

    this.pushParagraph(section, value);
  }

  private flushList(section: WorkingSection): void {
    if (!section.listBuffer.length) {
      return;
    }

    const items = section.listBuffer
      .map((item) => this.cleanInlineText(item))
      .filter(Boolean);
    section.listBuffer = [];

    if (!items.length) {
      return;
    }

    section.blocks.push({
      type: "list",
      items,
    });
    section.items.push(...items);
  }

  private pushParagraph(section: WorkingSection, value: string): void {
    if (!value) {
      return;
    }

    section.blocks.push({
      type: "paragraph",
      text: value,
    });
    section.paragraphs.push(value);
  }

  private hasSectionContent(section: WorkingSection): boolean {
    return (
      section.blocks.length > 0 ||
      section.paragraphs.length > 0 ||
      section.items.length > 0 ||
      section.tables.length > 0 ||
      section.paragraphBuffer.length > 0 ||
      section.listBuffer.length > 0
    );
  }

  private hasPersistedSectionContent(section: AiDisplaySection): boolean {
    return (
      section.blocks.length > 0 ||
      section.paragraphs.length > 0 ||
      section.items.length > 0 ||
      section.tables.length > 0
    );
  }

  private finalizeSection(section: WorkingSection): AiDisplaySection {
    return {
      heading: section.heading,
      blocks: section.blocks,
      paragraphs: section.paragraphs,
      items: section.items,
      tables: section.tables,
    };
  }
}
