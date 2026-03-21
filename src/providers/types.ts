export interface Ticket {
  id: string;
  identifier: string;
  title: string;
  description: string | undefined;
}

export interface TicketComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface TicketProvider {
  fetchReadyTickets(): Promise<Ticket[]>;
  fetchTicketsByStatus(statusName: string): Promise<Ticket[]>;
  transitionStatus(ticketId: string, statusName: string): Promise<void>;
  postComment(ticketId: string, body: string): Promise<void>;
  fetchComments(ticketId: string, since?: string): Promise<TicketComment[]>;
}
