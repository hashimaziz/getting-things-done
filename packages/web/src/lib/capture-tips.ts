/**
 * Why the capture screen asks nothing.
 *
 * Written as content rather than as a comment because it is the part a person using
 * the app needs to understand. The usual objection to capture tools is "where do I put
 * this?", and the answer only helps if it is on the screen where the question is asked.
 */

export interface CaptureTip {
  title: string;
  body: string;
}

export const INBOX_CAPTURE_TIPS: CaptureTip[] = [
  {
    title: 'Nothing is decided here',
    body: 'Not the container, not the project, not whether it is even actionable. Deciding while capturing is what stops people capturing.',
  },
  {
    title: 'Vague is fine',
    body: '"Something about the car" is a legitimate capture. The detail arrives later, or does not, and the item is still out of your head.',
  },
  {
    title: 'Inbox is not a to-do list',
    body: 'It holds what you have not yet thought about. Anything you start working from belongs in next actions.',
  },
];
