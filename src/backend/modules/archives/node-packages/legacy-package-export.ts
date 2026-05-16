import JSZip from 'jszip';
import { NODE_PACKAGE_TYPE, NODE_PACKAGE_VERSION } from '../contracts/package-types';

const sortKeys = (value: Record<string, unknown>) => Object.keys(value).sort();

export const buildWorkflowNodePackage = async (node: {
  description?: string | null;
  groupName?: string | null;
  name: string;
  nodeSchema: Record<string, unknown>;
  slug: string;
  sourceFiles: Record<string, string | undefined>;
}) => {
  const zip = new JSZip();
  const sourceFiles = sortKeys(node.sourceFiles).filter((path) => Boolean(node.sourceFiles[path]));
  zip.file(
    'node.json',
    JSON.stringify(
      {
        packageType: NODE_PACKAGE_TYPE,
        version: NODE_PACKAGE_VERSION,
        name: node.name,
        slug: node.slug,
        description: node.description || null,
        groupName: node.groupName || null,
        nodeSchema: node.nodeSchema,
        sourceFiles,
      },
      null,
      2,
    ),
  );
  for (const path of sourceFiles) zip.file(path, node.sourceFiles[path] || '');
  const buffer = await zip.generateAsync({ compression: 'DEFLATE', type: 'nodebuffer' });
  return { contentBase64: buffer.toString('base64'), fileName: `${node.slug}.node`, manifestPath: 'node.json', size: buffer.byteLength };
};
