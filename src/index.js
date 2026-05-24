require("dotenv").config();

const prism = require("prism-media");
const ffmpegPath = require("ffmpeg-static");
const axios = require("axios");
const NETEASE_API = process.env.NETEASE_API || "http://localhost:3000";

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
  entersState,
} = require("@discordjs/voice");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song from NetEase Cloud Music")
    .addStringOption((option) =>
        option
        .setName("query")
        .setDescription("Song name, or 'song by artist'")
        .setRequired(true)
    )
    .addStringOption((option) =>
        option
        .setName("artist")
        .setDescription("Artist name, optional")
        .setRequired(false)
    )
].map((command) => command.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  // Instant update for your test server
  await rest.put(
    Routes.applicationGuildCommands(
      process.env.CLIENT_ID,
      process.env.GUILD_ID
    ),
    { body: commands }
  );

  console.log("Guild slash commands registered.");

}

async function searchNeteaseSong(songName, artistName) {
  const keywords = artistName ? `${songName} ${artistName}` : songName;

  const searchRes = await axios.get(`${NETEASE_API}/search`, {
    params: {
      keywords,
      limit: 10,
    },
  });

  let songs = searchRes.data?.result?.songs;

  if (!songs || songs.length === 0) {
    throw new Error("No song found.");
  }

  if (artistName) {
    songs = songs.sort((a, b) => {
      const aArtists = a.artists?.map((artist) => artist.name).join(" ") || "";
      const bArtists = b.artists?.map((artist) => artist.name).join(" ") || "";

      const aMatch = aArtists.toLowerCase().includes(artistName.toLowerCase());
      const bMatch = bArtists.toLowerCase().includes(artistName.toLowerCase());

      return Number(bMatch) - Number(aMatch);
    });
  }

  for (const song of songs) {
    const urlRes = await axios.get(`${NETEASE_API}/song/url/v1`, {
      params: {
        id: song.id,
        level: "standard",
      },
    });

    const songUrl = urlRes.data?.data?.[0]?.url;

    if (songUrl) {
      return {
        id: song.id,
        title: song.name,
        artist: song.artists?.map((a) => a.name).join(", ") || "Unknown artist",
        url: songUrl,
      };
    }
  }

  throw new Error("Found songs, but none had a playable URL.");
}


client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

function parseSongQuery(query, artistOption) {
  if (artistOption) {
    return {
      songName: query.trim(),
      artistName: artistOption.trim(),
    };
  }

  const byMatch = query.match(/^(.+?)\s+by\s+(.+)$/i);

  if (byMatch) {
    return {
      songName: byMatch[1].trim(),
      artistName: byMatch[2].trim(),
    };
  }

  return {
    songName: query.trim(),
    artistName: null,
  };
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "play-test") {
    await interaction.deferReply();

    const voiceChannel = interaction.member.voice.channel;

    if (!voiceChannel) {
        return interaction.editReply("You need to join a voice channel first.");
    }

    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
    });

    const player = createAudioPlayer();

    player.on(AudioPlayerStatus.Playing, () => {
        console.log("Audio player status: Playing");
    });

    player.on(AudioPlayerStatus.Idle, () => {
        console.log("Audio player status: Idle");
    });

    player.on("error", (error) => {
        console.error("Audio player error:", error);
    });

    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
        console.log("Voice connection is ready.");

        const ffmpeg = new prism.FFmpeg({
        executable: ffmpegPath,
        args: [
            "-i",
            String.raw`C:\Users\k3252\Downloads\test.mp3`,
            "-analyzeduration",
            "0",
            "-loglevel",
            "0",
            "-f",
            "s16le",
            "-ar",
            "48000",
            "-ac",
            "2",
        ],
        });

        const resource = createAudioResource(ffmpeg, {
        inputType: StreamType.Raw,
        inlineVolume: true,
        });

        resource.volume.setVolume(1.5);

        connection.subscribe(player);
        player.play(resource);

        await interaction.editReply("Playing test audio with FFmpeg.");
    } catch (error) {
        console.error(error);
        await interaction.editReply("Failed to play test audio.");
    }
  }

  if (interaction.commandName === "play") {
    await interaction.deferReply();

    const query = interaction.options.getString("query");
    const artistOption = interaction.options.getString("artist");

    const { songName, artistName } = parseSongQuery(query, artistOption);

    const voiceChannel = interaction.member.voice.channel;

    if (!voiceChannel) {
        return interaction.editReply("You need to join a voice channel first.");
    }

    try {
        const song = await searchNeteaseSong(songName, artistName);

        const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        });

        await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

        const player = createAudioPlayer();

        const ffmpeg = new prism.FFmpeg({
        executable: ffmpegPath,
        args: [
            "-i",
            song.url,
            "-analyzeduration",
            "0",
            "-loglevel",
            "0",
            "-f",
            "s16le",
            "-ar",
            "48000",
            "-ac",
            "2",
        ],
        });

        const resource = createAudioResource(ffmpeg, {
        inputType: StreamType.Raw,
        inlineVolume: true,
        });

        resource.volume.setVolume(1.0);

        connection.subscribe(player);
        player.play(resource);

        player.on(AudioPlayerStatus.Playing, () => {
        console.log(`Playing: ${song.title}`);
        });

        player.on(AudioPlayerStatus.Idle, () => {
        console.log("Finished playing.");
        });

        player.on("error", (error) => {
        console.error("Audio player error:", error);
        });

        await interaction.editReply(`Now playing: **${song.title}** - ${song.artist}`);
    } catch (error) {
        console.error(error);
        await interaction.editReply(
        `Failed to play: ${error.message}\nTry another song, because NetEase may return no playable URL for some songs.`
        );
    }
  }
});

registerCommands()
  .then(() => client.login(process.env.DISCORD_TOKEN))
  .catch(console.error);

