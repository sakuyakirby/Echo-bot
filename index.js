const { Client, GatewayIntentBits, PermissionFlagsBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const TOKEN = 'MTQ4NDEzMzQ0NzA3MTk1NzA2Mg.GZ8bHb._BJXPzshBvElgX1AIUHhXNP_BEtwmpw_hn4G8w';
const CLIENT_ID = '1484133447071957062';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let db;

// データベースの初期化
(async () => {
    db = await open({
        filename: './database.sqlite',
        driver: sqlite3.Database
    });

    // 自動返信ルール用テーブル
    await db.exec(`
        CREATE TABLE IF NOT EXISTS auto_replies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT,
            type TEXT,
            trigger_word TEXT,
            response_word TEXT
        )
    `);

    // サーバー設定（ON/OFF）用テーブル
    await db.exec(`
        CREATE TABLE IF NOT EXISTS server_settings (
            guild_id TEXT PRIMARY KEY,
            enabled INTEGER DEFAULT 1
        )
    `);
    console.log('データベースの準備が完了しました。');
})();

// スラッシュコマンドの登録
const commands = [
    new SlashCommandBuilder()
        .setName('set')
        .setDescription('自動返信ルールを追加します')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addStringOption(opt => opt.setName('タイプ').setDescription('一致の種類').setRequired(true)
            .addChoices({ name: '完全一致', value: 'exact' }, { name: 'その単語を含む', value: 'partial' }))
        .addStringOption(opt => opt.setName('反応する言葉').setDescription('トリガーとなる言葉').setRequired(true))
        .addStringOption(opt => opt.setName('返信する言葉').setDescription('ボットが返信する内容').setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('list')
        .setDescription('現在の設定一覧を表示します'),

    new SlashCommandBuilder()
        .setName('delete')
        .setDescription('設定を削除します（ID指定）')
        .addIntegerOption(opt => opt.setName('id').setDescription('listコマンドで確認できるID').setRequired(true)),

    new SlashCommandBuilder()
        .setName('toggle')
        .setDescription('このサーバーでの自動返信をON/OFFにします')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('スラッシュコマンドを登録しました。');
    } catch (error) {
        console.error(error);
    }
})();

// インタラクション（コマンド）の処理
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // --- 設定コマンド ---
    if (interaction.commandName === 'set') {
        const type = interaction.options.getString('タイプ');
        const trigger = interaction.options.getString('反応する言葉');
        const response = interaction.options.getString('返信する言葉');

        await db.run('INSERT INTO auto_replies (guild_id, type, trigger_word, response_word) VALUES (?, ?, ?, ?)',
            [interaction.guildId, type, trigger, response]);

        await interaction.reply({ content: `✅ 設定を保存しました！\nワード: **${trigger}**`, ephemeral: true });
    }

    // --- 一覧コマンド ---
    if (interaction.commandName === 'list') {
        const rules = await db.all('SELECT * FROM auto_replies WHERE guild_id = ?', [interaction.guildId]);
        if (rules.length === 0) return interaction.reply({ content: '設定されているルールはありません。', ephemeral: true });

        const list = rules.map(r => `\`ID: ${r.id}\` | **${r.type === 'exact' ? '[完全一致]' : '[部分一致]'}** ${r.trigger_word} → ${r.response_word}`).join('\n');
        await interaction.reply({ content: `### 現在の自動返信設定\n${list}`, ephemeral: true });
    }

    // --- 削除コマンド ---
    if (interaction.commandName === 'delete') {
        const id = interaction.options.getInteger('id');
        const result = await db.run('DELETE FROM auto_replies WHERE id = ? AND guild_id = ?', [id, interaction.guildId]);
        
        if (result.changes > 0) {
            await interaction.reply({ content: `🗑️ ID: ${id} のルールを削除しました。`, ephemeral: true });
        } else {
            await interaction.reply({ content: `❌ ID: ${id} が見つかりませんでした。`, ephemeral: true });
        }
    }

    // --- 切り替えコマンド ---
    if (interaction.commandName === 'toggle') {
        const settings = await db.get('SELECT enabled FROM server_settings WHERE guild_id = ?', [interaction.guildId]);
        const currentStatus = settings ? settings.enabled : 1;
        const newStatus = currentStatus === 1 ? 0 : 1;

        await db.run('INSERT INTO server_settings (guild_id, enabled) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET enabled = ?',
            [interaction.guildId, newStatus, newStatus]);

        const statusLabel = newStatus === 1 ? '✅ **有効 (ON)**' : '❌ **無効 (OFF)**';
        await interaction.reply({ content: `自動返信を ${statusLabel} に切り替えました。`, ephemeral: true });
    }
});

// メッセージ受信時の処理
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guildId) return;

    // サーバーの有効/無効設定を確認
    const settings = await db.get('SELECT enabled FROM server_settings WHERE guild_id = ?', [message.guildId]);
    if (settings && settings.enabled === 0) return;

    // ルールに一致するか確認
    const rules = await db.all('SELECT * FROM auto_replies WHERE guild_id = ?', [message.guildId]);
    for (const rule of rules) {
        const content = message.content; // 大文字小文字を区別する場合はそのまま
        const trigger = rule.trigger_word;

        const isTriggered = rule.type === 'exact' 
            ? content === trigger 
            : content.includes(trigger);

        if (isTriggered) {
            return message.reply(rule.response_word);
        }
    }
});

client.login(TOKEN);
