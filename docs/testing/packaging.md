# Проверка T19/T20 — 2026-09-04

T18 пропущен по запросу владельца, T21 не выполнялся. Никакой публичной публикации нет.

## Выполнено локально

| Проверка                                             | Результат                           |
| ---------------------------------------------------- | ----------------------------------- |
| Windows typecheck, ESLint, Prettier, diff whitespace | Успешно                             |
| Windows unit                                         | 116 passed, 1 POSIX-only skip       |
| Linux unit (Debian 12, non-root)                     | 115 passed, 2 Windows-only skips    |
| Packaging contracts / собственные иконки             | 5 passed                            |
| OpenSSH + MinIO integration                          | 31 passed                           |
| Windows полный UI suite                              | 7 passed, 1 Linux-only skip         |
| Windows NSIS install → packaged smoke → uninstall    | Успешно, отдельный каталог/userData |
| Linux DEB install → packaged smoke → uninstall       | 2 passed                            |
| Linux AppImage extract → AppRun packaged smoke       | 2 passed                            |

Packaged smoke проверяет secure IPC, отсутствие Node в renderer, Unicode/пробелы в userData
и именах файлов, шифрование, реальный decrypt после рестарта, Local ↔ SFTP и Local ↔ S3
roundtrip с проверкой содержимого, сохранённый host fingerprint и повторный connect обоих
профилей после рестарта. Пароли/ключи используются только от одноразовых localhost fixtures.
Linux дополнительно проверяет настоящий `basic_text`: сообщение об отказе, отсутствие
созданного профиля и plaintext в SQLite. Отдельные unit tests проверяют также unknown/пустой
и будущий неподтверждённый backend, недоступность OS storage и повреждённый ciphertext.

Linux проверен настоящим Linux ELF в Debian 12 контейнере Docker Desktop/WSL2, не эмуляцией
Windows. Внутри non-root, Xvfb, отдельные D-Bus и GNOME Keyring. Только этот headless harness
передаёт `--no-sandbox` из-за ограничений nested namespaces; пакет/desktop launcher этого
флага не содержит. Проверка всех desktop Linux, FUSE mount и sandbox на реальной ОС остаётся
за рамками локального container smoke. AppImage проверен через официальный extract path.
Native Ubuntu CI не включает этот override.

Windows NSIS и все одноразовые тестовые контейнеры/сетевые fixtures удалены после проверки.
Существующие пользовательские профили и старый portable exe не удалялись.
Воспроизводимое test environment описано в `tests/packaging/Dockerfile`.

## Артефакты

Этот отчёт относится к сборкам до переименования в OpenSCP. Старые размеры и SHA-256
не применимы к новым пакетам. Актуальные результаты проверок OpenSCP находятся в
[отчёте переименования](openscp.md). Старые локальные бинарники не переименовывались.

## Что не подтверждено

- T19 реализован на уровне конфигурации, resources, signing/notarization workflow и smoke
  scripts, но **не прошёл macOS приёмку**. Нет Apple Silicon и сертификатов/ключей владельца.
- Не выполнены Gatekeeper/Finder на чистом Mac, изоляция Keychain от другого bundle ID,
  macOS SSH Agent и проверка подписанного обновления. Checklist — в `docs/release/packaging.md`.
- Hosted GitHub Actions workflows добавлены, но не запускались/не публиковались отсюда.
- Pageant/Cygwin не заявляются рабочими packaged-вариантами; ограничения в
  `docs/user/platforms.md`. Password protocol smoke не является agent smoke.
- Unsigned Windows setup не снимает SmartScreen предупреждение.
