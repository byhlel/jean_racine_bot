const { ChartJSNodeCanvas } = require('chartjs-node-canvas')
const mongoose = require('../utils/mongoose')
const { DateTime } = require('luxon')
const logger = require('./signale')

function range(i) {
  return [...Array(i).keys()]
}

async function getScore(id_challenge) {
  return (await mongoose.models.challenge.findOne({ id_challenge }) || {}).score || 0
}

module.exports = {
  async getMonthChart(guildId) { // On garde le nom ou on change pour get30DaysChart
    const channel = await mongoose.models.channels.findOne({ guildId })
    if (!channel) return logger.error(`Channel ${guildId} not found`)

    const tmpUsers = await mongoose.models.user.find({ id_auteur: { $in: (channel.users || []) } }, { validations: 1, score: 1, nom: 1 })
      .sort({ score: -1, nom: 1 })
      .limit(10)

    const datasets = []
    const colors = [
      'rgba(195, 40, 96, 1)', '#ffa500', '#00bcd4', '#ffd700', '#00ff77',
      'rgb(255,0,213)', 'rgba(8,255,0,0.66)', 'rgba(75,192,192,0.42)',
      'rgba(153,102,255,0.42)', 'rgba(255,123,0,0.2)'
    ]

    const now = DateTime.now().setLocale('fr')
    const startDate = now.minus({ days: 30 }).startOf('day')

    // Génération des labels (les 30 derniers jours)
    const labels = range(31).map(i => startDate.plus({ days: i }).toFormat('dd/MM'))

    let count = 0
    for (const user of tmpUsers) {
      // On récupère toutes les validations avec leurs scores
      const allValidations = await Promise.all((user.validations || []).map(async v => ({
        score: await getScore(Number(v.id_challenge)),
        date: DateTime.fromSQL(v.date).setLocale('fr')
      })))

      // Filtrer les validations qui ont eu lieu durant les 30 derniers jours
      const recentValidations = allValidations
        .filter(v => v.date >= startDate && v.date <= now)
        .sort((a, b) => a.date - b.date)

      // Calcul du score qu'avait l'utilisateur il y a 30 jours
      const score30DaysAgo = user.score - recentValidations.reduce((acc, obj) => acc + obj.score, 0)

      const data = []
      let currentRunningScore = score30DaysAgo

      // On remplit le graphique jour par jour
      for (let i = 0; i <= 30; i++) {
        const targetDate = startDate.plus({ days: i })
        const pointsThatDay = recentValidations
          .filter(v => v.date.hasSame(targetDate, 'day'))
          .reduce((acc, obj) => acc + obj.score, 0)

        currentRunningScore += pointsThatDay
        data.push(currentRunningScore)
      }

      datasets.push({
        label: user.nom,
        data,
        fill: false,
        pointRadius: 2,
        pointBackgroundColor: colors[count % colors.length],
        borderColor: colors[count % colors.length],
        tension: 0.1
      })
      count++
    }

    const width = 650
    const height = 470
    const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, chartCallback: (ChartJS) => {
      ChartJS.defaults.responsive = true
      ChartJS.defaults.maintainAspectRatio = false
    }})

    const configuration = {
      type: 'line',
      data: { labels, datasets },
      options: {
        scales: {
          y: { ticks: { color: 'rgba(250,250,250,0.7)' } },
          x: { ticks: { color: 'rgba(250,250,250,0.7)', maxRotation: 45, minRotation: 45 } }
        },
        plugins: {
          title: {
            display: true,
            text: 'Progression - 30 derniers jours',
            color: '#fff',
            font: { size: 18, weight: 'bold' }
          },
          legend: { labels: { color: '#fafafa', boxWidth: 10 } }
        }
      },
      plugins: [{
        id: 'background-colour',
        beforeDraw: (chart) => {
          const ctx = chart.ctx
          ctx.save()
          ctx.fillStyle = '#202b33'
          ctx.fillRect(0, 0, width, height)
          ctx.restore()
        }
      }]
    }

    return await chartJSNodeCanvas.renderToBuffer(configuration)
  }
}
