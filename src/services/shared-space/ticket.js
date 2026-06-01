"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyDriveUploadTicket = exports.createDriveUploadTicket = exports.assertDriveUploadTicketConfig = void 0;
const node_crypto_1 = require("node:crypto");
const routing_controllers_1 = require("routing-controllers");
const env_1 = require("@connectingmatrix/orm/env");
const secret = () => env_1.EnvLoader.getOrThrow('SERVER_SECRET');
const assertDriveUploadTicketConfig = () => {
    env_1.EnvLoader.getOrThrow('SERVER_SECRET');
};
exports.assertDriveUploadTicketConfig = assertDriveUploadTicketConfig;
const sign = (body) => (0, node_crypto_1.createHmac)('sha256', secret()).update(body).digest('hex');
const fields = (payload) => [
    payload.purpose,
    payload.scopeKind,
    payload.scopeId,
    payload.userId,
    payload.organizationId || '',
    payload.path,
    payload.fileName,
    payload.mimeType,
    `${payload.maxBytes}`,
    `${payload.expiresAt}`,
];
const bodyFrom = (payload) => fields(payload).map(encodeURIComponent).join('\n');
const requiredField = (value, name) => {
    if (!value)
        throw new routing_controllers_1.BadRequestError(`${name} is required.`);
    return value;
};
const numberField = (value, name) => {
    const numberValue = Number(requiredField(value, name));
    if (!Number.isFinite(numberValue))
        throw new routing_controllers_1.BadRequestError(`${name} is invalid.`);
    return numberValue;
};
const purposeField = (value) => {
    if (value === 'drive' || value === 'ai-agent')
        return value;
    throw new routing_controllers_1.BadRequestError('Drive upload ticket purpose is invalid.');
};
const scopeKindField = (value) => {
    if (value === 'user' || value === 'organization')
        return value;
    throw new routing_controllers_1.BadRequestError('Drive upload ticket scope is invalid.');
};
const ticketFrom = (form) => {
    return {
        purpose: purposeField(form.driveTicketPurpose),
        scopeKind: scopeKindField(form.driveTicketScopeKind),
        scopeId: requiredField(form.driveTicketScopeId, 'driveTicketScopeId'),
        userId: requiredField(form.driveTicketUserId, 'driveTicketUserId'),
        organizationId: form.driveTicketOrganizationId || null,
        path: requiredField(form.driveTicketPath, 'driveTicketPath'),
        fileName: requiredField(form.driveTicketFileName, 'driveTicketFileName'),
        mimeType: requiredField(form.driveTicketMimeType, 'driveTicketMimeType'),
        maxBytes: numberField(form.driveTicketMaxBytes, 'driveTicketMaxBytes'),
        expiresAt: numberField(form.driveTicketExpiresAt, 'driveTicketExpiresAt'),
    };
};
const createDriveUploadTicket = (payload) => {
    const body = bodyFrom(payload);
    return { payload, signature: sign(body) };
};
exports.createDriveUploadTicket = createDriveUploadTicket;
const verifyDriveUploadTicket = (form) => {
    const payload = ticketFrom(form);
    const signature = requiredField(form.driveTicketSignature, 'driveTicketSignature');
    const body = bodyFrom(payload);
    const expected = sign(body);
    const left = Buffer.from(signature, 'hex');
    const right = Buffer.from(expected, 'hex');
    if (left.length !== right.length || !(0, node_crypto_1.timingSafeEqual)(left, right))
        throw new routing_controllers_1.BadRequestError('Drive upload ticket is invalid.');
    if (payload.expiresAt < Date.now())
        throw new routing_controllers_1.BadRequestError('Drive upload ticket expired.');
    return payload;
};
exports.verifyDriveUploadTicket = verifyDriveUploadTicket;
