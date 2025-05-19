export interface RenderedItem {
  columnId: string;
  content?: string;
  id: string;
  order: number;
  title: string;
}

export const CONTENT_TYPES = {
  card: "application/app-card",
  column: "application/app-column",
};

export const INTENTS = {
  updateBoardName: "updateBoardName" as const,
  updateColumnName: "updateColumnName" as const,
};

export const ItemMutationFields = {
  columnId: { name: "columnId", type: String },
  id: { name: "id", type: String },
  order: { name: "order", type: Number },
  title: { name: "title", type: String },
} as const;
