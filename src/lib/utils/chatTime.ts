// Chat bubble timestamps (public ChatThread + dashboard Respond tab): bare
// time for today's messages, day + time once a message is older.
const timeFmt = new Intl.DateTimeFormat('en-KE', { hour: '2-digit', minute: '2-digit', hour12: false });
const dayTimeFmt = new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

export function formatChatTime(iso: string): string {
	const date = new Date(iso);
	return date.toDateString() === new Date().toDateString() ? timeFmt.format(date) : dayTimeFmt.format(date);
}
