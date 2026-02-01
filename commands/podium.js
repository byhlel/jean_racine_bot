const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageAttachment } = require('discord.js');
const nodeHtmlToImage = require('node-html-to-image');
const { curly } = require('node-libcurl'); // On utilise curly déjà présent dans ton projet
const logger = require('../utils/signale');
const fs = require('fs');
const path = require('path');
const { getProfilePicture } = require('../utils/get_profile_picture');
const mongoose = require('../utils/mongoose');
const v8 = require('v8');

// 1. Polyfill pour Node 16
if (typeof structuredClone === 'undefined') {
    global.structuredClone = function(obj) {
        return v8.deserialize(v8.serialize(obj));
    };
}

// Fonction pour transformer une URL d'image en Base64
async function getBase64Image(url) {
    try {
        if (!url) return null;
        // On utilise l'User-Agent pour ne pas être bloqué par Root-Me
        const { data } = await curly.get(url, {
            httpHeader: ['User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)']
        });
        return `data:image/png;base64,${Buffer.from(data).toString('base64')}`;
    } catch (e) {
        logger.error(`Erreur Base64 pour ${url}:`, e.message);
        return null;
    }
}

const htmlPath = path.join(process.cwd(), 'assets', 'podium.html');
const htmlTemplate = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf-8') : '';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('podium')
        .setDescription('Affiche le podium avec les vraies photos de profil'),

    async execute(interaction) {
        await interaction.deferReply();

        try {
            const channel = await mongoose.models.channels.findOne({ guildId: interaction.guildId });
            if (!channel || !channel.users) return await interaction.editReply("Aucun utilisateur enregistré.");

            const tmpUsers = await mongoose.models.user.find({
                id_auteur: { $in: channel.users }
            }).sort({ score: -1, nom: 1 }).limit(3);

            if (tmpUsers.length === 0) return await interaction.editReply("Base de données vide.");

            logger.info(`Préparation du podium pour : ${tmpUsers.map(v => v.nom).join(', ')}`);

            // Image par défaut si le user n'a pas de PP
            const defUrl = (process.env.ROOTME_URL || 'https://www.root-me.org') + '/IMG/logo/auton0.png';

            // 2. On récupère les URLs des PP (exactement comme dans /user)
            const ppsUrls = await Promise.all([
                getProfilePicture(tmpUsers[0]?.id_auteur).catch(() => defUrl),
                tmpUsers[1] ? getProfilePicture(tmpUsers[1].id_auteur).catch(() => defUrl) : Promise.resolve(defUrl),
                tmpUsers[2] ? getProfilePicture(tmpUsers[2].id_auteur).catch(() => defUrl) : Promise.resolve(defUrl)
            ]);

            // 3. Conversion de chaque URL en Base64 pour garantir l'affichage
            const ppsBase64 = await Promise.all(ppsUrls.map(url => getBase64Image(url || defUrl)));

            logger.info('Génération du rendu HTML...');

            const image = await nodeHtmlToImage({
                html: htmlTemplate,
                content: {
                    name1: tmpUsers[0]?.nom || 'N/A',
                    pp1: ppsBase64[0] || '', // Ici on injecte le Base64
                    name2: tmpUsers[1]?.nom || 'N/A',
                    pp2: ppsBase64[1] || '',
                    name3: tmpUsers[2]?.nom || 'N/A',
                    pp3: ppsBase64[2] || ''
                },
                puppeteerArgs: {
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                }
            });

            const attachment = new MessageAttachment(image, 'podium.png');
            await interaction.editReply({ files: [attachment] });

        } catch (err) {
            logger.error('Erreur Podium:', err);
            await interaction.editReply({ content: 'Erreur technique lors de la création de l\'image.', ephemeral: true });
        }
    }
};
