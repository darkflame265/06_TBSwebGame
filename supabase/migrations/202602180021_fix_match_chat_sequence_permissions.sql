begin;

grant usage, select on sequence public.match_chat_messages_id_seq to authenticated;

commit;
