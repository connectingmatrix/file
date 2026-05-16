import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { datasetProfileForAttachment } from '../io/agent-clickhouse-dataset-profile';
import type { AgentCreationAttachment } from '@connectingmatrix/ai-agents/services/ai-agents/contracts';
import type { AgentDatasetColumnProfile, AgentDatasetProfile, AgentDatasetTableProfile } from '../contracts/agent-clickhouse-dataset-types';

const SMALL_ARCHIVE_BYTES = 5 * 1024 * 1024;

const startBytes = async (path: string, limit = 64 * 1024): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const stream = createReadStream(path, { highWaterMark: 16 * 1024 });
    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      total += chunk.length;
      if (total >= limit) stream.destroy();
    });
    stream.on('close', () => resolve(Buffer.concat(chunks).subarray(0, limit)));
    stream.on('error', reject);
  });

const table = (tableName: string, columns: AgentDatasetColumnProfile[], rows: number): AgentDatasetTableProfile => ({
  tableName,
  rowEstimate: rows,
  columnCount: columns.length,
  primaryKeyHint: columns[0]?.columnName || '',
  columns,
});

const column = (tableName: string, name: string, sample = ''): AgentDatasetColumnProfile => ({
  tableName,
  columnName: name || 'value',
  valueType: 'String',
  nullable: true,
  sampleValue: sample,
});

const delimitedTable = (fileName: string, sample: Buffer, delimiter: string): AgentDatasetTableProfile => {
  const text = sample.toString('utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = (lines[0] || 'value').split(delimiter);
  const columns: AgentDatasetColumnProfile[] = [];
  for (const header of headers)
    columns.push(column('rows', header.trim() || `column_${columns.length + 1}`, lines[1]?.split(delimiter)[columns.length] || ''));
  return table(fileName.replace(/[^a-z0-9_]+/gi, '_').toLowerCase(), columns, Math.max(0, lines.length - 1));
};

const zipTable = async (fileName: string, path: string, sizeBytes: number): Promise<AgentDatasetTableProfile | null> => {
  if (sizeBytes > SMALL_ARCHIVE_BYTES) return null;
  const zip = await JSZip.loadAsync(await startBytes(path, sizeBytes));
  const columns = [column('archive_entries', 'path'), column('archive_entries', 'kind'), column('archive_entries', 'bytes')];
  return table(`${fileName.replace(/[^a-z0-9_]+/gi, '_').toLowerCase()}_entries`, columns, Object.keys(zip.files).length);
};

const excelTable = async (fileName: string, path: string, sizeBytes: number): Promise<AgentDatasetTableProfile | null> => {
  if (sizeBytes > SMALL_ARCHIVE_BYTES) return null;
  const workbook = XLSX.readFile(path, { sheetRows: 50 });
  const sheetName = workbook.SheetNames[0] || 'Sheet1';
  const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[sheetName], { header: 1, blankrows: false });
  const headers = rows[0] || ['value'];
  const columns: AgentDatasetColumnProfile[] = [];
  for (const header of headers)
    columns.push(column(sheetName, String(header || `column_${columns.length + 1}`), String((rows[1] || [])[columns.length] || '')));
  return table(sheetName, columns, Math.max(0, rows.length - 1));
};

export async function inspectAgentDatasetAttachment(
  agentId: string,
  sourceShapeId: string,
  file: AgentCreationAttachment,
): Promise<AgentDatasetProfile> {
  const info = await stat(file.path);
  const profile = datasetProfileForAttachment(agentId, sourceShapeId, { ...file, sizeBytes: info.size });
  const sample = await startBytes(file.path);
  if (/\.csv$/i.test(file.fileName)) profile.tables = [delimitedTable(file.fileName, sample, ',')];
  if (/\.tsv$/i.test(file.fileName)) profile.tables = [delimitedTable(file.fileName, sample, '\t')];
  if (/\.jsonl$/i.test(file.fileName))
    profile.tables = [
      table(
        'jsonl_records',
        [column('jsonl_records', 'json', sample.toString('utf8').split(/\r?\n/)[0] || '{}')],
        sample.toString('utf8').split(/\r?\n/).filter(Boolean).length,
      ),
    ];
  if (/\.xlsx?$/i.test(file.fileName)) profile.tables = [(await excelTable(file.fileName, file.path, info.size)) || profile.tables[0]];
  if (/\.(zip|docx|pptx)$/i.test(file.fileName)) profile.tables = [(await zipTable(file.fileName, file.path, info.size)) || profile.tables[0]];
  if (/\.sqlite$|\.db$/i.test(file.fileName) && !sample.subarray(0, 16).toString('utf8').includes('SQLite format')) profile.status = 'failed';
  profile.rowEstimate = profile.tables.reduce((sum, item) => sum + item.rowEstimate, 0);
  profile.byteEstimate = info.size;
  return profile;
}
