import { AuthModule } from '../auth/auth.module';
import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway';
import { GameService } from './game.service';
import { GameStore } from './game.store';
import { BackgroundController } from './background.controller';

@Module({
  imports: [AuthModule],
  controllers: [BackgroundController],
  providers: [GameGateway, GameService, GameStore],
})
export class GameModule {}
