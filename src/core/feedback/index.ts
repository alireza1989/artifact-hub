// core/feedback — comments + synthesis orchestration (PLAN §3.1, §5.2). Comment
// add/list ship in Phase 2 (backing MCP add_comment/get_feedback); AI synthesis
// arrives in Phase 4 (getFeedback.summary is null until then).
export {
  type AddCommentArgs,
  addComment,
  type CreatedComment,
  listComments,
} from "./comments";
export {
  type FeedbackResult,
  type FeedbackSummary,
  getFeedback,
} from "./get-feedback";
