import { useMemo, useState } from "react";
import type { KeyboardEvent } from "react";

type Mode = "inspection" | "samsung-note" | "blank-report";

type CopyResult = {
  ok: boolean;
  message: string;
};

type ModelSerial = {
  model: string;
  serial: string;
};

type TestMode = "inspection" | "samsung-note" | "blank-report" | "shared";

type TestCase = {
  name: string;
  input: string;
  mode: TestMode;
  expected?: string;
  expectedFunction?: boolean;
};

type TestResult = TestCase & {
  passed: boolean;
  actual: string;
};

const ITEM_DIVIDER = "_____________________________";
const SECTION_DIVIDER = "------------------------------------";

function isDividerLine(line: string): boolean {
  return /^\s*[-_]{5,}\s*$/.test(line);
}

function findLine(lines: string[], regex: RegExp): string | null {
  return lines.find((line: string) => regex.test(line)) || null;
}

function normalizeLabelSpacing(line: string): string {
  return line.replace(/^([^:]+):\s*/, "$1: ");
}

function collectMultilineField(
  cleaned: string[],
  startRegex: RegExp,
  stopRegex: RegExp,
  defaultLines: string[],
  normalizeFirst = true
): string[] {
  const startIndex = cleaned.findIndex((line: string) => startRegex.test(line));
  if (startIndex < 0) return defaultLines;

  const firstLine = normalizeFirst ? normalizeLabelSpacing(cleaned[startIndex]) : cleaned[startIndex];
  const collected: string[] = [firstLine];

  for (let i = startIndex + 1; i < cleaned.length; i += 1) {
    const nextLine = cleaned[i];
    if (stopRegex.test(nextLine)) break;
    if (/^\d+\./.test(nextLine)) break;
    collected.push(nextLine);
  }

  return collected;
}

function collectExtraLines(cleaned: string[]): string[] {
  return collectMultilineField(
    cleaned,
    /^여분\s*:/,
    /^(한틴이카유무|주차비지원유무|특이사항|모델명|시리얼넘버|자산기번|내용|처리내용|매수|토너잔량|폐통)\s*:/,
    ["여분: K- C- M- Y- 폐- "]
  );
}

function collectNoteLines(cleaned: string[]): string[] {
  return collectMultilineField(
    cleaned,
    /^특이사항\s*:/,
    /^(모델명|시리얼넘버|자산기번|내용|처리내용|매수|토너잔량|폐통|여분|한틴이카유무|주차비지원유무)\s*:/,
    ["특이사항:"]
  );
}

function collectParkingLines(cleaned: string[]): string[] {
  return collectMultilineField(
    cleaned,
    /^주차비지원유무\s*:/,
    /^(특이사항|모델명|시리얼넘버|자산기번|내용|처리내용|매수|토너잔량|폐통|여분|한틴이카유무)\s*:/,
    ["주차비지원유무: "]
  );
}

function collectHeaderMultiline(
  lines: string[],
  startRegex: RegExp,
  stopRegex: RegExp,
  defaultLines: string[]
): string[] {
  const startIndex = lines.findIndex((line: string) => startRegex.test(line));
  if (startIndex < 0) return defaultLines;

  const collected: string[] = [normalizeLabelSpacing(lines[startIndex])];

  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const nextLine = lines[i];
    if (stopRegex.test(nextLine)) break;
    if (isDividerLine(nextLine)) break;
    collected.push(nextLine);
  }

  return collected;
}

function buildItemTitleLine(cleaned: string[], blockIndex: number): string {
  const firstLine = cleaned[0] || "";
  const modelIndex = cleaned.findIndex((line: string) => /^모델명\s*:/.test(line));

  if (/^\d+\./.test(firstLine)) {
    return firstLine;
  }

  if (modelIndex > 0 && firstLine && !/:/.test(firstLine)) {
    return `${blockIndex + 1}. ${firstLine.trim()}`;
  }

  return `${blockIndex + 1}.`;
}

function stripConsumedTitleLine(cleaned: string[]): string[] {
  const firstLine = cleaned[0] || "";
  const modelIndex = cleaned.findIndex((line: string) => /^모델명\s*:/.test(line));

  if (/^\d+\./.test(firstLine)) return cleaned.slice(1);
  if (modelIndex > 0 && firstLine && !/:/.test(firstLine)) return cleaned.slice(1);

  return cleaned;
}

function normalizeItemBlock(blockLines: string[], blockIndex: number): string[] {
  const cleaned = blockLines
    .map((line: string) => line.trimEnd())
    .filter((line: string) => line !== "" && !isDividerLine(line));

  if (cleaned.length === 0) return [];

  const titleLine = buildItemTitleLine(cleaned, blockIndex);
  const contentLines = stripConsumedTitleLine(cleaned);

  const modelLine = findLine(contentLines, /^모델명\s*:/);
  const serialLine = findLine(contentLines, /^시리얼넘버\s*:/);
  const assetLine = findLine(contentLines, /^자산기번\s*:/);
  const hantinLine = findLine(contentLines, /^한틴이카유무\s*:/) || "한틴이카유무:";
  const extraLines = collectExtraLines(contentLines);
  const parkingLines = collectParkingLines(contentLines);
  const noteLines = collectNoteLines(contentLines);

  return [
    titleLine,
    modelLine || "모델명:",
    serialLine || "시리얼넘버:",
    assetLine || "자산기번: ",
    "내용: 정기점검",
    "처리내용: 정기점검",
    "매수: 흑-    컬-    큰컬-    합-",
    "토너잔량:K-   C-   M-   Y-",
    "폐통:        %",
    ...extraLines,
    hantinLine,
    ...parkingLines,
    ...noteLines,
  ];
}

function splitItemBlocks(lines: string[]): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (isDividerLine(line)) {
      if (current.length > 0) {
        blocks.push(current);
        current = [];
      }
      continue;
    }
    current.push(line);
  }

  if (current.length > 0) blocks.push(current);
  return blocks;
}

function transformInspectionText(input: string): string {
  if (!input || !input.trim()) return "";

  const lines = input.split(/\r?\n/);
  const firstDividerIndex = lines.findIndex((line: string) => isDividerLine(line));
  const itemStartIndex = firstDividerIndex >= 0 ? firstDividerIndex : lines.length;
  const headerLines = lines.slice(0, itemStartIndex);
  const bodyLines = lines.slice(itemStartIndex);

  const gradeLines = collectHeaderMultiline(
    headerLines,
    /^등급\s*:/,
    /^(작성자|구분|레벨|업체명|부서명|지역|키맨\/접수자)\s*:/,
    ["등급:  "]
  );
  const companyLines = collectHeaderMultiline(
    headerLines,
    /^업체명\s*:/,
    /^(작성자|구분|레벨|등급|부서명|지역|키맨\/접수자)\s*:/,
    ["업체명: "]
  );
  const departmentLines = collectHeaderMultiline(
    headerLines,
    /^부서명\s*:/,
    /^(작성자|구분|레벨|등급|업체명|지역|키맨\/접수자)\s*:/,
    ["부서명: "]
  );
  const regionLines = collectHeaderMultiline(
    headerLines,
    /^지역\s*:/,
    /^(작성자|구분|레벨|등급|업체명|부서명|키맨\/접수자)\s*:/,
    ["지역: "]
  );
  const keymanLines = collectHeaderMultiline(
    headerLines,
    /^키맨\/접수자\s*:/,
    /^(작성자|구분|레벨|등급|업체명|부서명|지역)\s*:/,
    ["키맨/접수자:"]
  );

  const normalizedHeader: string[] = [
    "작성자: ",
    "구분: 점검",
    "레벨: 1",
    ...gradeLines,
    ...companyLines,
    ...departmentLines,
    ...regionLines,
    ...keymanLines,
  ];

  const partsIndex = bodyLines.findIndex((line: string) => /^\s*※부품신청※\s*$/.test(line));
  const selfIndex = bodyLines.findIndex((line: string) => /^\s*※자가신청※\s*$/.test(line));
  const arrivalIndex = bodyLines.findIndex((line: string) => /^도착 시간\s*:/.test(line));
  const durationIndex = bodyLines.findIndex((line: string) => /^소요 시간\s*:/.test(line));

  let itemSectionEnd = bodyLines.length;
  if (partsIndex >= 0) itemSectionEnd = Math.min(itemSectionEnd, partsIndex);
  if (selfIndex >= 0) itemSectionEnd = Math.min(itemSectionEnd, selfIndex);
  if (arrivalIndex >= 0) itemSectionEnd = Math.min(itemSectionEnd, arrivalIndex);
  if (durationIndex >= 0) itemSectionEnd = Math.min(itemSectionEnd, durationIndex);

  const rawItemSection = bodyLines.slice(0, itemSectionEnd);
  const itemBlocks = splitItemBlocks(rawItemSection);
  const normalizedItemSection: string[] = [];

  itemBlocks.forEach((block: string[], index: number) => {
    const normalizedBlock = normalizeItemBlock(block, index);
    if (normalizedBlock.length === 0) return;
    normalizedItemSection.push(ITEM_DIVIDER);
    normalizedItemSection.push(...normalizedBlock);
  });

  const standardizedParts: string[] = [
    SECTION_DIVIDER,
    "※부품신청※",
    "보증기간 내 여부 : ",
    "교체 전 카운터 누적 사용매수 : ",
    "사용 부품 예상 사용매수 : ",
    "▶ 신청 부품",
    "물품명:",
    "수량:",
    "출고여부: ",
    SECTION_DIVIDER,
    "※자가신청※",
    "물품:",
    "수량:",
    "출고여부:",
    ITEM_DIVIDER,
    "도착 시간:",
    "소요 시간:",
  ];

  return [...normalizedHeader, ...normalizedItemSection, ...standardizedParts].join("\n");
}

function splitScheduleBlocks(input: string): string[][] {
  if (!input || !input.trim()) return [];

  const lines = input.split(/\r?\n/).map((line: string) => line.trimRight());
  const blocks: string[][] = [];
  let current: string[] = [];

  lines.forEach((line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (/^#/.test(trimmed) && current.length === 0) return;

    if (/^\d+\./.test(trimmed)) {
      if (current.length > 0) blocks.push(current);
      current = [trimmed];
      return;
    }

    if (current.length === 0) return;
    current.push(trimmed);
  });

  if (current.length > 0) blocks.push(current);
  return blocks;
}

function normalizeSamsungText(text: string): string {
  return text
    .replace(/주식회사/g, "")
    .replace(/\(유\)/g, "")
    .replace(/\(개인\)/g, "")
    .replace(/분기마감/g, "")
    .replace(/매월마감/g, "")
    .replace(/매년마감/g, "")
    .replace(/단순마감마감/g, "")
    .replace(/단순마감/g, "")
    .replace(/전일연락필수/g, "")
    .replace(/준전일연락필수/g, "")
    .replace(/진성완료/g, "")
    .replace(/현장종료/g, "")
    .replace(/운영팀/g, "")
    .replace(/개인영업/g, "")
    .replace(/퍼스트/g, "")
    .replace(/전자/g, "")
    .replace(/레벨\d+/g, "")
    .replace(/레벨\s*\d+/g, "")
    .replace(/대체기지참/g, "")
    .replace(/용지없음에러/g, "")
    .replace(/PC셋팅/g, "")
    .replace(/종료일[^\n]*/g, "")
    .replace(/접수일[^\n]*/g, "")
    .replace(/지역[^\n]*/g, "")
    .replace(/\*\*.*?\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyAddressLine(line: string): boolean {
  return /(서울|경기|인천|부산|대구|광주|대전|울산|세종|충북|충남|전북|전남|경북|경남|강원|제주|로|길|구|동|번지)/.test(line);
}

function isLikelyPhoneLine(line: string): boolean {
  return /(01\d[- ]?\d{3,4}[- ]?\d{4}|0\d{1,2}[- ]?\d{3,4}[- ]?\d{4})/.test(line);
}

function isLikelyModelLine(line: string): boolean {
  return (
    /([A-Za-z가-힣0-9][A-Za-z가-힣0-9._-]{1,})\s*\/\s*([A-Z0-9-]{6,})/.test(line) ||
    /(SL-|DocuCentre|DocuPrint|ECOSYS|Apeos|IR-|bizhub|TASKalfa|MX-|C2263|D470|D320|D450|X3220|C3373|C3375|MFC-)/i.test(line)
  );
}

function dedupeRepeatedPhrase(text: string): string {
  const compact = text.replace(/\s+/g, "");
  const known = [
    "대흥스페이스",
    "행복",
    "아인기획",
    "셔츠팩토리",
    "폴리테루",
    "서원피앤씨",
    "원밀리언",
    "문워크디자인",
    "올림커뮤니케이션",
    "광은교회",
    "하이대부자산관리",
  ];
  const found = known.find((item: string) => compact.includes(item.replace(/\s+/g, "")));
  if (found) return found;
  return text.trim();
}

function extractTopSummaryLine(lines: string[]): string {
  const first = (lines[0] || "").replace(/^\d+\.\s*/, "").trim();
  return first || "점검";
}

function extractLocationLabel(lines: string[]): string {
  const joined = lines.join(" ");
  const basementFloorMatch = joined.match(/(지하\s*\d+층|B\s*\d+층)/i);
  if (basementFloorMatch) return basementFloorMatch[1].replace(/\s+/g, "");
  const hoMatch = joined.match(/(\d+호)/);
  if (hoMatch) return hoMatch[1];
  const floorDotMatch = joined.match(/(\d+[·.]\d+층)/);
  if (floorDotMatch) {
    const floorText = floorDotMatch[1];
    const parts = floorText.match(/\d+/g);
    if (parts && parts.length > 0) return `${parts[parts.length - 1]}층`;
  }
  const floorMatch = joined.match(/(\d+층)/);
  if (floorMatch) return floorMatch[1];
  const dongMatch = joined.match(/(\d+동)/);
  if (dongMatch) return dongMatch[1];
  return "미기재";
}

function extractCompanyFromPrimaryLine(line: string): string {
  if (!line) return "";

  let raw = line.trim();

  raw = raw.replace(/^\d+(NN|SS|S|N|V)/, "").trim();
  raw = raw.replace(/^(이민구|김정식|손영근|신정훈|박진영|김숙영|박옥주|현호진|김정민|이홍진|정준영)\s+/, "");

  const slashIndex = raw.indexOf("/");
  if (slashIndex >= 0) {
    raw = raw.slice(0, slashIndex).trim();
  }

  raw = raw
    .replace(/주식회사/g, "")
    .replace(/단순마감마감/g, "")
    .replace(/단순마감/g, "")
    .replace(/분기마감/g, "")
    .replace(/매월마감/g, "")
    .replace(/매년마감/g, "")
    .replace(/전일연락필수/g, "")
    .replace(/준전일연락필수/g, "")
    .replace(/진성완료/g, "")
    .replace(/현장종료/g, "")
    .replace(/레벨\s*\d+/g, "")
    .replace(/대체기지참/g, "")
    .replace(/용지없음에러/g, "")
    .replace(/[·•]/g, " ")
    .replace(/\b(NN|SS|S|N|V)\b/g, "")
    .trim();

  raw = raw
    .replace(/^[-,\s]+/, "")
    .replace(/[-,\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

  const modelCut = raw.search(/\b(SL-|MFC-|DocuPrint|DocuCentre|ECOSYS|Apeos|bizhub|IR-|TASKalfa|MX-|HP-)/i);
  if (modelCut >= 0) {
    raw = raw.slice(0, modelCut).trim();
  }

  return raw;
}

function cleanCompanyCandidate(candidate: string): string {
  return normalizeSamsungText(candidate)
    .replace(/^\d+(NN|SS|S|N|V)/, "")
    .replace(/^\d+[A-Z]?S/, "")
    .replace(/^요\s*[가-힣A-Za-z]+\s*-\s*/, "")
    .replace(/^[가-힣A-Za-z]+\s*-\s*/, "")
    .replace(/^건축사사무소/, "")
    .replace(/^법무법인\s*/, "")
    .replace(/^세무법인\s*/, "")
    .replace(/^주식회사\s*/, "")
    .replace(/\s*주식회사\s*/g, " ")
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/(?:,\s*)?주식회사\s*/g, " ")
    .replace(/(?:서초|강남|송파|성동|화성)사무실$/, "")
    .replace(/(?:서초|강남|송파|성동|화성)구$/, "")
    .replace(/\s*-\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractKnownCompany(line: string): string {
  if (!line) return "";

  const primary = extractCompanyFromPrimaryLine(line);
  if (primary) return primary;

  const cleaned = cleanCompanyCandidate(line);
  if (!cleaned) return "";

  const beforeComma = cleaned.split(",")[0].trim();
  const shortened = beforeComma
    .replace(/단순마감마감/g, "")
    .replace(/단순마감/g, "")
    .replace(/분기마감/g, "")
    .replace(/매월마감/g, "")
    .replace(/매년마감/g, "")
    .replace(/전일연락필수/g, "")
    .replace(/준전일연락필수/g, "")
    .replace(/진성완료/g, "")
    .replace(/현장종료/g, "")
    .replace(/레벨\s*\d+/g, "")
    .replace(/대체기지참/g, "")
    .replace(/용지없음에러/g, "")
    .replace(/\b(NN|SS|S|N|V)\b/g, "")
    .replace(/(?:금요일만 방문 가능|점심시간.*|엘베.*|계단.*|사진첨부.*|주정차.*)$/g, "")
    .replace(/\s*-\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (shortened) return shortened;

  const parts = cleaned
    .split(/[\/-]/)
    .map((part: string) => part.trim())
    .filter(Boolean)
    .filter((part: string) => !isLikelyAddressLine(part) && !isLikelyPhoneLine(part) && !isLikelyModelLine(part));

  const preferred = parts.find((part: string) => /[가-힣A-Za-z]{2,}/.test(part));
  return preferred ? dedupeRepeatedPhrase(preferred) : "";
}

function extractCompanySummary(lines: string[]): string {
  const joined = lines.slice(1).join(" ").replace(/\s+/g, " ").trim();

  const quotedGradeCompanyMatch = joined.match(/"?\d*(?:NN|SS|S|N|V)\s*([가-힣A-Za-z0-9㈜&()]+)\s*-\s*본사/);
  if (quotedGradeCompanyMatch) {
    return quotedGradeCompanyMatch[1]
      .replace(/주식회사/g, "")
      .replace(/㈜/g, "")
      .trim();
  }

  const primaryLine = lines[1] || "";

  if (primaryLine) {
    const compactPrimary = primaryLine.replace(/\s+/g, " ").trim();
    const inlinePrimaryMatch = compactPrimary.match(
      /(?:^|\s)(?:[가-힣]{2,4}\s+)?(?:오전\d+시전\s+)?(?:세팅\s+)?(?:납품\s+)?([가-힣A-Za-z0-9]+(?:학원|교회|회사|법인|디자인|피앤씨|기획|팩토리|코리아|메디칼|코스메틱|바이오|안전|사이언스))\s+[A-Za-z0-9-]+(?:\([^)]*\))?\s*\/\s*서울/
    );
    if (inlinePrimaryMatch) return inlinePrimaryMatch[1].trim();
  }

  const primaryCompany = extractKnownCompany(primaryLine);
  if (primaryCompany) return primaryCompany;

  const descriptiveLine = lines.find(
    (line: string, index: number) =>
      index > 0 && !isLikelyAddressLine(line) && !isLikelyPhoneLine(line) && !isLikelyModelLine(line)
  );

  if (descriptiveLine) {
    const compact = descriptiveLine.replace(/\s+/g, " ").trim();
    const inlineMatch = compact.match(
      /(?:^|\s)(?:[가-힣]{2,4}\s+)?(?:오전\d+시전\s+)?(?:세팅\s+)?(?:납품\s+)?([가-힣A-Za-z0-9]+(?:학원|교회|회사|법인|디자인|피앤씨|기획|팩토리|코리아|메디칼|코스메틱|바이오|안전|사이언스))\s+[A-Za-z0-9-]+(?:\([^)]*\))?\s*\/\s*서울/
    );
    if (inlineMatch) return inlineMatch[1].trim();
  }

  const contentLines = lines.slice(1);
  for (const line of contentLines) {
    if (isLikelyAddressLine(line) || isLikelyPhoneLine(line) || isLikelyModelLine(line)) continue;
    const company = extractKnownCompany(line);
    if (company) return company;
  }

  const company = extractKnownCompany(joined);
  return company || "미기재";
}

function transformSamsungNoteTitles(input: string): string[] {
  const blocks = splitScheduleBlocks(input);
  return blocks.map((lines: string[], index: number) => {
    const rawTopLine = extractTopSummaryLine(lines);
    const finalTopLine = rawTopLine && rawTopLine !== "." ? rawTopLine : "점검";
    const company = extractCompanySummary(lines);
    const location = extractLocationLabel(lines);
    return `${index + 1}/${company} ${location}/${finalTopLine}`;
  });
}

function splitParagraphBlocks(input: string): string[][] {
  if (!input || !input.trim()) return [];

  const normalized = input.trim();
  const explicitMultiBlocks = normalized
    .split(/\n\s*\n+/)
    .map((block: string) => block.split(/\r?\n/).map((line: string) => line.trim()).filter(Boolean))
    .filter((block: string[]) => block.length > 0);

  const hasNumberedSchedules = /^\d+\./m.test(normalized);
  const hasRepeatedTypeMarkers = (normalized.match(/(?:^|\n)(A\/S|여분요청|점검)\b/g) || []).length > 1;

  if (hasNumberedSchedules || hasRepeatedTypeMarkers) {
    return explicitMultiBlocks;
  }

  return [normalized.split(/\r?\n/).map((line: string) => line.trim()).filter(Boolean)];
}

function extractReportType(text: string): string {
  if (/여분요청/.test(text)) return "여분요청";
  if (/\bA\/S\b/.test(text)) return "A/S";
  return "점검";
}

function extractReportLevel(text: string, type: string): string {
  if (type === "점검") return "1";
  if (type === "A/S") {
    const match = text.match(/레벨\s*([123])/);
    return match ? match[1] : "";
  }
  return "";
}

function extractGrade(text: string): string {
  const tokenMatch = text.match(/(?:^|\s)(NN|SS|S|N|V)(?=\s|$)/);
  if (tokenMatch) return tokenMatch[1];
  const companyPrefixedMatch = text.match(/(?:^|\s)\d+(NN|SS|S|N|V)(?=[가-힣("])/);
  if (companyPrefixedMatch) return companyPrefixedMatch[1];
  return "";
}

function extractCompanyForTemplate(text: string): string {
  const compact = text.replace(/\s+/g, " ");
  const quotedMatch = compact.match(
    /"\s*\d*(주식회사[^"]*?|법무법인[^"]*?|세무법인[^"]*?|[^"]*?(?:의원|치과|회사|교회|법인|디자인|피앤씨|기획|팩토리|택스))\s*(?:분기마감|매월마감|매년마감)/
  );
  if (quotedMatch) return quotedMatch[1].trim().replace(/-\s*$/, "");

  const companyAfterGradeMatch = compact.match(
    /(?:^|\s)\d+(NN|SS|S|N|V)([^\n]*?)(분기마감|매월마감|매년마감|오픈\s*\d*시?반?분기마감|오픈\s*\d*시?반?|단순마감마감|단순마감)/
  );
  if (companyAfterGradeMatch) {
    return companyAfterGradeMatch[2]
      .replace(/^\s*"/, "")
      .replace(/"\s*$/, "")
      .trim()
      .replace(/-\s*$/, "");
  }

  const fallback = compact.match(
    /(법무법인\s*[가-힣A-Za-z0-9\s]+|세무법인\s*[가-힣A-Za-z0-9\s]+|주식회사\s*[가-힣A-Za-z0-9\s]+|㈜\s*[가-힣A-Za-z0-9\s]+|[가-힣A-Za-z0-9\s]+(?:의원|치과|회사|교회|법인|디자인|피앤씨|기획|팩토리|택스))/
  );
  return fallback ? fallback[1].trim().replace(/-\s*$/, "") : "";
}

function extractDepartment(text: string): string {
  const match = text.match(/(\d+호|\d+층)/);
  if (match) return match[1];
  const suiteMatch = text.match(/상가\s*(\d+호)/);
  if (suiteMatch) return suiteMatch[1];
  return "";
}

function extractPhonesWithContext(text: string): string {
  const contactNameMatch = text.match(
    /접수자성함\s*([^\n]+?)\s+접수자연락처\s*(01\d[- ]?\d{3,4}[- ]?\d{4}|0\d{1,2}[- ]?\d{3,4}[- ]?\d{4})/
  );
  if (contactNameMatch) return `${contactNameMatch[1].trim()} ${contactNameMatch[2].trim()}`;

  const contactPhoneOnlyMatch = text.match(
    /접수자연락처\s*(01\d[- ]?\d{3,4}[- ]?\d{4}|0\d{1,2}[- ]?\d{3,4}[- ]?\d{4})/
  );
  if (contactPhoneOnlyMatch) return contactPhoneOnlyMatch[1].trim();

  const genericContactBlockMatch = text.match(/연락처\s+(01\d[- ]?\d{3,4}[- ]?\d{4})\s*([^\n]*)/);
  if (genericContactBlockMatch) {
    const phone = genericContactBlockMatch[1].trim();
    const name = (genericContactBlockMatch[2] || "").trim();
    return name ? `${phone} ${name}` : phone;
  }

  return "";
}

function extractModelAndSerial(text: string): ModelSerial {
  const modelMatch = text.match(
    /기종\s+((?:ApeosPort|Apeos|ECOSYS|SL-|DocuCentre|DocuPrint|bizhub|IR-|TASKalfa|MX-|HP-|MFC-|[A-Za-z가-힣0-9][A-Za-z가-힣0-9._-]{1,})[^\s\n]*)/i
  );
  const serialMatch = text.match(/(?:기번|시리얼넘버)\s+([A-Z0-9-]+)/i);
  if (modelMatch || serialMatch) {
    return {
      model: modelMatch ? modelMatch[1].trim() : "",
      serial: serialMatch ? serialMatch[1].trim() : "",
    };
  }

  const slashMatch = text.match(
    /((?:ApeosPort|Apeos|ECOSYS|SL-|DocuCentre|DocuPrint|bizhub|IR-|TASKalfa|MX-|HP-|MFC-)[^/\n\s]*)\s*\/\s*([A-Z0-9-]+)/i
  );
  if (slashMatch) return { model: slashMatch[1].trim(), serial: slashMatch[2].trim() };

  const genericSlashLineMatch = text.match(
    /(?:^|\n|\s)(?!한조\/틴텍코드)([A-Za-z가-힣][A-Za-z가-힣0-9._-]{1,})\s*\/\s*([A-Z0-9-]{6,})(?=\s|$)/
  );
  if (genericSlashLineMatch) {
    return { model: genericSlashLineMatch[1].trim(), serial: genericSlashLineMatch[2].trim() };
  }

  return { model: "", serial: "" };
}

function extractAssetNumber(text: string): string {
  const match = text.match(/자산번호\s+([A-Z]\d+)/i);
  return match ? match[1].trim() : "";
}

function extractStatusText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const quotedStatusMatch = normalized.match(/(?:^|\s)상태\s+"\s*(.*?)\s*"\s*(?:제목\s*.*)?$/);
  if (quotedStatusMatch) return quotedStatusMatch[1].trim();
  const plainStatusMatch = normalized.match(/(?:^|\s)상태\s+(.*?)\s*(?:제목\s*.*)?$/);
  if (plainStatusMatch) return plainStatusMatch[1].trim();
  return "";
}

function extractTitleText(text: string): string {
  const titleMatch = text.match(/제목\s+([^\n]+)/);
  return titleMatch ? titleMatch[1].trim() : "";
}

function extractTemplateContent(text: string, type: string): string {
  if (type === "여분요청") return extractStatusText(text) || extractTitleText(text) || "";
  if (type === "A/S") return extractStatusText(text) || extractTitleText(text) || "";
  return "정기점검";
}

function extractTemplateProcessContent(_text: string, type: string): string {
  if (type === "점검") return "정기점검";
  return "";
}

function buildBlankReport(blockLines: string[]): string {
  const text = blockLines.join(" ");
  const type = extractReportType(text);
  const level = extractReportLevel(text, type);
  const grade = extractGrade(text);
  const company = extractCompanyForTemplate(text);
  const department = extractDepartment(text);
  const keyman = extractPhonesWithContext(text);
  const ms = extractModelAndSerial(text);
  const assetNumber = extractAssetNumber(text);
  const content = extractTemplateContent(text, type);
  const processContent = extractTemplateProcessContent(text, type);

  return [
    "작성자:",
    `구분:${type}`,
    `레벨:${level}`,
    `등급:${grade}`,
    `업체명:${company}`,
    `부서명:${department}`,
    "지역:C",
    `키맨/접수자:${keyman}`,
    ITEM_DIVIDER,
    `모델명:${ms.model}`,
    `시리얼넘버:${ms.serial}`,
    `자산기번: ${assetNumber}`,
    `내용: ${content}`,
    `처리내용:${processContent ? ` ${processContent}` : ""}`,
    "매수:흑- 컬- 큰컬- 합-",
    "토너잔량:K- C- M- Y-",
    "폐통:  %",
    "여분:  K- C- M- Y- 토너 SET  폐-",
    "한틴이카유무:",
    "주차비지원유무:",
    "특이사항:",
    ITEM_DIVIDER,
    "※부품신청※",
    "보증기간 내 여부 :",
    "교체 전 카운터 누적 사용매수 :",
    "사용 부품 예상 사용매수 :",
    "▶ 신청 부품",
    "물품명:",
    "수량:",
    "출고여부:",
    ITEM_DIVIDER,
    "※자가신청※",
    "물품:",
    "수량:",
    "출고여부:",
    ITEM_DIVIDER,
    "도착 시간:",
    "소요 시간:",
  ].join("\n");
}

function transformBlankReports(input: string): string[] {
  const blocks = splitParagraphBlocks(input);
  return blocks.map((block: string[]) => buildBlankReport(block));
}

function copyTextFallback(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }

  document.body.removeChild(textarea);
  return copied;
}

async function copyTextToClipboard(text: string): Promise<CopyResult> {
  if (!text) return { ok: false, message: "복사할 내용이 없습니다." };

  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true, message: "결과를 복사했습니다." };
    } catch {
      const fallbackSucceeded = copyTextFallback(text);
      if (fallbackSucceeded) return { ok: true, message: "결과를 복사했습니다." };
      return { ok: false, message: "브라우저 권한으로 복사가 차단되었습니다. 결과창에서 직접 선택해 복사해 주세요." };
    }
  }

  const fallbackSucceeded = copyTextFallback(text);
  if (fallbackSucceeded) return { ok: true, message: "결과를 복사했습니다." };
  return { ok: false, message: "브라우저 권한으로 복사가 차단되었습니다. 결과창에서 직접 선택해 복사해 주세요." };
}

const TEST_CASES: TestCase[] = [
  {
    name: "업체명 여러 줄 유지",
    input: "업체명: 주식회사 필립오토서비스\n부가설명 한 줄 더\n부서명: 303호\n-------------------------------------",
    expected: "부가설명 한 줄 더",
    mode: "inspection",
  },
  {
    name: "주차비지원유무 여러 줄 유지",
    input: "-------------------------------------\n모델명: ECOSYS\n주차비지원유무 : 주차하려했으나 발렛 5천원\n다음 방문시 공용주차 요청\n특이사항: 테스트",
    expected: "다음 방문시 공용주차 요청",
    mode: "inspection",
  },
  {
    name: "키맨 접수자 여러 줄 유지",
    input: "구분: 점검\n키맨/접수자: 홍길동\n010-1111-1111\n김철수 부장\n-------------------------------------",
    expected: "김철수 부장",
    mode: "inspection",
  },
  {
    name: "특이사항 여러 줄 유지",
    input: "-------------------------------------\n모델명: ECOSYS\n특이사항: 첫줄\n둘째줄\n셋째줄",
    expected: "셋째줄",
    mode: "inspection",
  },
  {
    name: "여분 아래줄 위치 유지",
    input: "-------------------------------------\n모델명: ECOSYS\n여분: 토너1 SET\n(복합기 밑 서랍장)\n한틴이카유무: 한공",
    expected: "(복합기 밑 서랍장)",
    mode: "inspection",
  },
  {
    name: "위치 제목 자동 번호 부여",
    input: "-------------------------------------\n15층입구\n모델명: D470\n시리얼넘버: 809150608947",
    expected: "1. 15층입구",
    mode: "inspection",
  },
  {
    name: "제목 없으면 번호만 생성",
    input: "-------------------------------------\n모델명: D470\n시리얼넘버: 809150608947\n-------------------------------------\n모델명: D470\n시리얼넘버: 809150710281",
    expected: "2.",
    mode: "inspection",
  },
  {
    name: "처리내용 번호문장 제목 오인식 방지",
    input: "작성자: 신정훈\n구분: AS\n레벨: ( 4 )\n등급 : SS\n업체명: 이든에듀2관\n부서명 :\n지역: C\n키맨/접수자:\n키맨성함/번호\n서은관    010-8798-3139\n-------------------------------------\n모델명: K7500\n시리얼넘버: 0A3FBJPR30000QT\n자산기번 : B6691\n내용: , 피니셔 걸쳐 나온 용지를 받쳐주는 것이 자동으로 올라오지 않습니다\n처리내용:\n1. 피니셔에서 출력물이 나온 후 자동으로 돌아가지 않음 확인.\n2. 안수복 부파트장 문의.",
    expected: "\n1.\n모델명: K7500",
    mode: "inspection",
  },
  {
    name: "국제안전 업체명 정리",
    input: "2.교체\n이민구 레벨3 대체기지참·용지없음에러 NN 주식회사 국제안전 MFC-L5700DN / 서울 광진구 동일로 327 3·4층",
    expected: "1/국제안전 4층/교체",
    mode: "samsung-note",
  },
  {
    name: "코리움사이언스 단순마감 제거",
    input: "8.점검\n30N코리움사이언스-단순마감마감\nDocuPrint-CM305DF/WCP-060021\n서울 성동구 아차산로7나길 18\n에이팩센터 504호",
    expected: "1/코리움사이언스 504호/점검",
    mode: "samsung-note",
  },
  {
    name: "삼성노트 한 줄 설명형 업체명",
    input: "1.확인서\n이민구 오전10시전 세팅 납품 책나무강동선사암사독서논술학원 X3220NR(리퍼) / 서울 강동구 상암로5길 83 2층",
    expected: "1/책나무강동선사암사독서논술학원 2층/확인서",
    mode: "samsung-note",
  },
  {
    name: "빈 보고서 느슨한 형식 한 건 유지",
    input: "7S주식회사 정주시에스시-분기마감\nSL-X7400LXR/ZPBLBJST70004RM\n\n위치\n서울 송파구 위례성대로2길 11\n상가 206호\n\n연락처\n010-2081-5985 오석환님",
    expected: "부서명:206호",
    mode: "blank-report",
  },
  {
    name: "빈 보고서 느슨한 형식 연락처",
    input: "7S주식회사 정주시에스시-분기마감\nSL-X7400LXR/ZPBLBJST70004RM\n\n위치\n서울 송파구 위례성대로2길 11\n상가 206호\n\n연락처\n010-2081-5985 오석환님",
    expected: "키맨/접수자:010-2081-5985 오석환님",
    mode: "blank-report",
  },
  {
    name: "여분요청 상태 우선",
    input: "여분요청 SS DocuPrint-C5005D 상태 M토너 교체안내완료 여분 일정 통화 부탁드립니다. 제목",
    expected: "내용: M토너 교체안내완료 여분 일정 통화 부탁드립니다.",
    mode: "blank-report",
  },
  {
    name: "기종 기번 우선",
    input: "A/S N HP-8730 한조/틴텍코드 18496 / 216163 주소 서울 강남구 대치동 삼성로 64길 5 기종 HP-8730 기번 CN950C60F9",
    expected: "모델명:HP-8730",
    mode: "blank-report",
  },
  {
    name: "한조 틴텍코드 오인식 방지",
    input: "A/S N HP-8730 한조/틴텍코드 18496 / 216163 주소 서울 강남구 대치동 삼성로 64길 5 기종 HP-8730 기번 CN950C60F9",
    expected: "시리얼넘버:CN950C60F9",
    mode: "blank-report",
  },
  {
    name: "복사 함수 준비",
    input: "noop",
    expectedFunction: true,
    mode: "shared",
  },
];

function runSelfTests(): TestResult[] {
  return TEST_CASES.map((test: TestCase) => {
    if (test.expectedFunction) {
      const passed = typeof copyTextToClipboard === "function" && typeof copyTextFallback === "function";
      return { ...test, passed, actual: passed ? "function ready" : "missing function" };
    }

    let actual = "";
    if (test.mode === "samsung-note") actual = transformSamsungNoteTitles(test.input).join("\n");
    else if (test.mode === "blank-report") actual = transformBlankReports(test.input).join("\n");
    else actual = transformInspectionText(test.input);

    return {
      ...test,
      passed: typeof test.expected === "string" ? actual.includes(test.expected) : false,
      actual,
    };
  });
}

export default function App() {
  const [mode, setMode] = useState<Mode>("samsung-note");
  const [inputText, setInputText] = useState<string>("");
  const [outputText, setOutputText] = useState<string>("");
  const [titleOutputs, setTitleOutputs] = useState<string[]>([]);
  const [blankReports, setBlankReports] = useState<string[]>([]);
  const [copyStatus, setCopyStatus] = useState<string>("복사용 출력");

  const lineStats = useMemo(() => {
    const count = inputText ? inputText.split(/\r?\n/).length : 0;
    return `${count} lines`;
  }, [inputText]);

  const testResults = useMemo(() => runSelfTests(), []);
  const passedCount = testResults.filter((item: TestResult) => item.passed).length;

  const handleTransform = () => {
    if (mode === "inspection") {
      const result = transformInspectionText(inputText);
      setOutputText(result);
      setTitleOutputs([]);
      setBlankReports([]);
    } else if (mode === "samsung-note") {
      const titles = transformSamsungNoteTitles(inputText);
      setTitleOutputs(titles);
      setOutputText(titles.join("\n"));
      setBlankReports([]);
    } else {
      const reports = transformBlankReports(inputText);
      setBlankReports(reports);
      setOutputText(reports.join("\n\n"));
      setTitleOutputs([]);
    }
    setCopyStatus("복사용 출력");
  };

  const handleCopy = async () => {
    const targetText =
      mode === "inspection"
        ? outputText
        : mode === "samsung-note"
          ? titleOutputs.join("\n")
          : blankReports.join("\n\n");

    const result = await copyTextToClipboard(targetText);
    setCopyStatus(result.message);
    window.setTimeout(() => setCopyStatus("복사용 출력"), 2500);
  };

  const handleCopySingleTitle = async (title: string) => {
    const result = await copyTextToClipboard(title);
    setCopyStatus(result.message);
    window.setTimeout(() => setCopyStatus("복사용 출력"), 2500);
  };

  const handleCopySingleReport = async (report: string) => {
    const result = await copyTextToClipboard(report);
    setCopyStatus(result.message);
    window.setTimeout(() => setCopyStatus("복사용 출력"), 2500);
  };

  const handleReset = () => {
    setInputText("");
    setOutputText("");
    setTitleOutputs([]);
    setBlankReports([]);
    setCopyStatus("복사용 출력");
  };

  const handleInputKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleTransform();
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">점검이력 변환기</h1>
                <p className="mt-1 text-sm text-slate-600 sm:text-base">
                  점검이력 표준화, 삼성노트 제목 생성, 빈 보고서 양식 생성을 한 화면에서 처리하는 웹앱
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
                최종 정리본 · App 단일 엔트리
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => {
                  setMode("samsung-note");
                  setCopyStatus("복사용 출력");
                }}
                className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                  mode === "samsung-note"
                    ? "bg-slate-900 text-white"
                    : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                삼성노트 제목 생성
              </button>

              <button
                onClick={() => {
                  setMode("inspection");
                  setCopyStatus("복사용 출력");
                }}
                className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                  mode === "inspection"
                    ? "bg-slate-900 text-white"
                    : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                점검이력 변환
              </button>

              <button
                onClick={() => {
                  setMode("blank-report");
                  setCopyStatus("복사용 출력");
                }}
                className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                  mode === "blank-report"
                    ? "bg-slate-900 text-white"
                    : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                빈 보고서 양식 생성
              </button>
            </div>
          </div>
        </header>

        <main className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">원본 입력</h2>
              <span className="text-sm text-slate-400">{lineStats}</span>
            </div>
            <textarea
              value={inputText}
              onKeyDown={handleInputKeyDown}
              onChange={(e) => setInputText(e.target.value)}
              className="h-[420px] w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm outline-none transition focus:border-slate-400"
              placeholder={
                mode === "inspection"
                  ? "여기에 -시작- 부터 -끝- 까지의 원본 점검이력을 붙여넣으세요."
                  : mode === "samsung-note"
                    ? "여기에 번호가 붙은 스케줄 원문을 여러 개 붙여넣으세요."
                    : "여기에 스케줄 원문을 문단별로 붙여넣으세요."
              }
            />
          </section>

          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">변환 결과</h2>
              <span className="text-right text-sm text-slate-400">{copyStatus}</span>
            </div>

            {mode === "inspection" ? (
              <textarea
                value={outputText}
                className="h-[420px] w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm outline-none"
                placeholder="여기에 변환 결과가 표시됩니다."
                readOnly
              />
            ) : mode === "samsung-note" ? (
              <div className="h-[420px] overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-4">
                {titleOutputs.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">
                    생성된 제목이 여기에 표시됩니다.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {titleOutputs.map((title: string, index: number) => (
                      <div key={`${title}-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-slate-700">스케줄 {index + 1}</div>
                          <button
                            onClick={() => handleCopySingleTitle(title)}
                            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                          >
                            코드 복사
                          </button>
                        </div>
                        <pre className="overflow-x-auto rounded-xl bg-slate-50 p-3 text-sm text-slate-800">
                          <code>{title}</code>
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="h-[420px] overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-4">
                {blankReports.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">
                    생성된 보고서 양식이 여기에 표시됩니다.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {blankReports.map((report: string, index: number) => (
                      <div key={`${index}-${report.slice(0, 20)}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-slate-700">보고서 {index + 1}</div>
                          <button
                            onClick={() => handleCopySingleReport(report)}
                            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                          >
                            코드 복사
                          </button>
                        </div>
                        <pre className="overflow-x-auto rounded-xl bg-slate-50 p-3 text-sm text-slate-800">
                          <code>{report}</code>
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </main>

        <section className="mt-6 rounded-3xl bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button
              onClick={handleTransform}
              className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
            >
              변환하기
            </button>
            <button
              onClick={handleCopy}
              className="rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              {mode === "inspection" ? "결과 복사" : mode === "samsung-note" ? "전체 코드 복사" : "전체 보고서 복사"}
            </button>
            <button
              onClick={handleReset}
              className="rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              전체 초기화
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            일부 브라우저 환경에서는 자동 복사가 차단될 수 있습니다. 그 경우 결과창을 직접 선택해 복사하면 됩니다.
          </p>
        </section>

        <section className="mt-6 rounded-3xl bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">내장 테스트</h3>
            <span className="text-sm text-slate-400">
              {passedCount}/{testResults.length} 통과
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {testResults.map((test: TestResult) => (
              <div key={test.name} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-800">{test.name}</p>
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-semibold ${
                      test.passed ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                    }`}
                  >
                    {test.passed ? "통과" : "실패"}
                  </span>
                </div>
                <div className="mt-3 space-y-2 text-xs text-slate-600">
                  <p>{test.expectedFunction ? "복사 대체 함수 준비 여부 확인" : `기대 포함값: ${test.expected}`}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}