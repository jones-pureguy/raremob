const fs = require('fs');

var textFields = ['title', 'description'];
var hintLevels = ['level1', 'level2', 'level3'];

// Process stages.json
var stages = JSON.parse(fs.readFileSync('./stages.json', 'utf8'));
stages.forEach(function(stage) {
  textFields.forEach(function(field) {
    if (stage[field] && typeof stage[field] === 'string') {
      stage[field] = { ko: stage[field] };
    }
  });
  if (stage.hint) {
    hintLevels.forEach(function(level) {
      if (stage.hint[level] && typeof stage.hint[level] === 'string') {
        stage.hint[level] = { ko: stage.hint[level] };
      }
    });
  }
});
fs.writeFileSync('./stages.json', JSON.stringify(stages, null, 2));
console.log('stages.json: ' + stages.length + ' stages converted');

// Process puzzles.json
var puzzles = JSON.parse(fs.readFileSync('./puzzles.json', 'utf8'));
puzzles.forEach(function(puzzle) {
  textFields.forEach(function(field) {
    if (puzzle[field] && typeof puzzle[field] === 'string') {
      puzzle[field] = { ko: puzzle[field] };
    }
  });
  if (puzzle.hint) {
    hintLevels.forEach(function(level) {
      if (puzzle.hint[level] && typeof puzzle.hint[level] === 'string') {
        puzzle.hint[level] = { ko: puzzle.hint[level] };
      }
    });
  }
});
fs.writeFileSync('./puzzles.json', JSON.stringify(puzzles, null, 2));
console.log('puzzles.json: ' + puzzles.length + ' puzzles converted');
