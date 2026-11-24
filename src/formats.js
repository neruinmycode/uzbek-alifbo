export const fileTypes = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
};

export class ConversionError extends Error {
  constructor(code, pages = []) {
    super(code);
    this.code = code;
    this.pages = pages;
  }
}
