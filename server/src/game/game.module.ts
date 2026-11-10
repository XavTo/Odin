import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway';
import { GameService } from './game.service';
import { GameStore } from './game.store';

@Module({
  providers: [GameGateway, GameService, GameStore],
})
export class GameModule {}
