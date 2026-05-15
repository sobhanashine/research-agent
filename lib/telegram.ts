const TG_API = (token: string) => `https://api.telegram.org/bot${token}`;

export async function sendMessage(token: string, chatId: number, text: string, replyTo?: number) {
  const res = await fetch(`${TG_API(token)}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      reply_to_message_id: replyTo,
    }),
  });
  return res.json();
}

export async function sendChatAction(token: string, chatId: number, action: string) {
  await fetch(`${TG_API(token)}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action }),
  });
}

export async function sendDocument(
  token: string,
  chatId: number,
  filename: string,
  buffer: Buffer,
  caption: string,
  replyTo?: number
) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (replyTo) form.append("reply_to_message_id", String(replyTo));
  form.append("caption", caption);
  const blob = new Blob([new Uint8Array(buffer)], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  form.append("document", blob, filename);

  const res = await fetch(`${TG_API(token)}/sendDocument`, {
    method: "POST",
    body: form,
  });
  return res.json();
}
