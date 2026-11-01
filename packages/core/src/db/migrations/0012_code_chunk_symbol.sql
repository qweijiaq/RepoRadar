-- 代码块记录所属的函数/类/类型名，便于按符号检索和展示证据。
ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS symbol TEXT;
