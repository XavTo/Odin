import { Controller, Get, Header } from '@nestjs/common';
import { GameService } from './game.service';

@Controller()
export class BackgroundController {
  constructor(private readonly game: GameService) {}

  @Get('background')
  @Header('Cache-Control', 'no-store')
  getBackground(): { background: string | null } {
    return { background: this.game.getPhotos().background ?? null };
  }
}
