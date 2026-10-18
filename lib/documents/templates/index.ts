/**
 * Template registry — maps a letter type slug to its renderer.
 * Server-only; imported by the letters API routes.
 */
import type { LetterType, RenderedLetter, TemplateInput } from "../letter-data";
import { render as approvalInPrinciple } from "./approval-in-principle";
import { render as finalApproval } from "./final-approval";
import { render as documentRequest } from "./document-request";
import { render as engagementFeeProposal } from "./engagement-fee-proposal";
import { render as paymentReceipt } from "./payment-receipt";

const REGISTRY: Record<LetterType, (input: TemplateInput) => Promise<RenderedLetter>> = {
  APPROVAL_IN_PRINCIPLE: approvalInPrinciple,
  FINAL_APPROVAL: finalApproval,
  DOCUMENT_REQUEST: documentRequest,
  ENGAGEMENT_FEE_PROPOSAL: engagementFeeProposal,
  PAYMENT_RECEIPT: paymentReceipt,
};

export function renderLetter(type: LetterType, input: TemplateInput): Promise<RenderedLetter> {
  return REGISTRY[type](input);
}
