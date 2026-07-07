# db-migrate action

本番 RDS への Drizzle マイグレーション（`db:migrate` / 初回 `db:baseline`）を CI から安全に実行する
composite action。フリート各 hono repo の deploy / 手動 DB オペレーション workflow から共通利用する。

## やっていること

1. OIDC で `role-to-assume` を assume（`id-token: write` 権限が呼び出し job に必要）。
2. runner の Public IP を取得し、`sg-id`（RDS の Security Group）へ 3306 を**一時許可**。
3. Secrets Manager の `secret-id`（RDS マネージド secret: host/port/dbname/username/password）から接続情報を取得。
4. `working-directory` で `npm run <command>` を実行（Drizzle が RDS に接続してマイグレーション適用）。
5. **成否に関わらず** SG の一時許可を revoke（`always()`）。runner IP を開けっぱなしにしない。

RDS は本番のみが対象。dev は各自のローカル MySQL に `npm run db:migrate` で当てる（この action は使わない）。

## inputs

| input | required | default | 説明 |
| --- | --- | --- | --- |
| `role-to-assume` | ✔ | — | OIDC で assume する AWS ロール ARN（例: GitHubDeploySAM） |
| `aws-region` | ✔ | — | AWS リージョン（OSS 都合でデフォルトは持たせない） |
| `sg-id` | ✔ | — | RDS の Security Group ID（3306 を一時許可する対象） |
| `secret-id` | ✔ | — | Secrets Manager の RDS マネージド secret 名 |
| `command` | — | `db:migrate` | `npm run` で実行する Drizzle スクリプト（`db:migrate` / `db:baseline` など） |
| `working-directory` | — | `./hono` | hono プロジェクトのパス |

`sg-id` は RDS 単位で共通（同一 RDS を共有する複数アプリは同一 SG）。`secret-id` はアプリ単位（`<app>/mysql`）。

## 呼び出し側の前提（アプリごとに一度きり整備）

- `role-to-assume` の IAM ロールに以下を付与:
  - `ec2:AuthorizeSecurityGroupIngress` / `ec2:RevokeSecurityGroupIngress`（対象 RDS SG）
  - `secretsmanager:GetSecretValue`（`<app>/mysql`）
  - OIDC trust policy に当該 repo を許可
- `<app>/mysql` の DB ユーザは対象スキーマへの DDL 権限を持つこと。
- 呼び出し job に `permissions: { id-token: write, contents: read }`。

## 使い方

### deploy（tag デプロイに組み込み、worker デプロイ前に自動 migrate）

```yaml
jobs:
  deployHono:
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
      - run: npm ci
        working-directory: ./hono
      - name: DB migrate
        uses: rdlabo-team/workers-hono-kit/.github/actions/db-migrate@v0.3.6
        with:
          role-to-assume: arn:aws:iam::<account-id>:role/<role-name>
          aws-region: <region>
          sg-id: <rds-sg-id>
          secret-id: <app>/mysql
          command: db:migrate
      - name: Deploy to Cloudflare Workers
        run: npx wrangler deploy
        working-directory: ./hono
```

migrate が失敗すれば job が止まり、未マイグレーションの DB に新コードをデプロイしない。

### 手動 DB オペレーション（初回 baseline / ad-hoc 再適用）

`workflow_dispatch` + `environment: production`（approval ゲート）で受ける。`baseline` は brownfield 初回
（既存スキーマを migration 適用済みとしてマークするだけで DDL は流さない）、`migrate` は ad-hoc 再適用。

```yaml
on:
  workflow_dispatch:
    inputs:
      action:
        type: choice
        options: [baseline, migrate]
jobs:
  db:
    environment: production
    permissions:
      id-token: write
      contents: read
    steps:
      # ... checkout / setup-node / npm ci ...
      - uses: rdlabo-team/workers-hono-kit/.github/actions/db-migrate@v0.3.6
        with:
          role-to-assume: arn:aws:iam::<account-id>:role/<role-name>
          aws-region: <region>
          sg-id: <rds-sg-id>
          secret-id: <app>/mysql
          command: db:${{ inputs.action }}
```

## baseline / 適用検知の仕組み（brownfield）

Drizzle は `__drizzle_migrations(id, hash, created_at)` テーブルで適用済み migration を管理する。
**適用済み判定は `created_at` の最大値のみ**で行う（hash は記録されるが検知には使わない）。

既存スキーマを持つ本番（brownfield）にいきなり `migrate` を当てると、既に存在するテーブルを
`CREATE TABLE` しようとして失敗する。そのため初回だけ `baseline` を実行し、現行の migration 群を
「適用済み」としてテーブルに記録する（DDL は実行しない）。以降は通常の `migrate` で差分だけが当たる。

`db:baseline` / `db:migrate` スクリプトの実体はアプリ側 `hono/package.json` に定義する
（DB 名のデフォルト等アプリ固有値を持てる）。kit は `workers-hono-kit-db-baseline` バイナリを提供する。
